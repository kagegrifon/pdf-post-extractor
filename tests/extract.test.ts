import { PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { classifyOpenError, collectZoneLines, extractFile, extractShipment } from '../src/extract';
import { DEFAULT_TEXTS, makeBlank } from './fixtures/makeBlank';
import { realDataAvailable, realExpected, realFiles } from './helpers/realData';

async function extractOk(bytes: Uint8Array) {
  const res = await extractShipment('test.pdf', bytes);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.shipment;
}

async function extractErr(bytes: Uint8Array) {
  const res = await extractShipment('test.pdf', bytes);
  if (res.ok) throw new Error('expected error');
  return res.error;
}

describe('collectZoneLines', () => {
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  it('orders lines top-to-bottom then left-to-right, drops empty and $-prefixed items', () => {
    const lines = collectZoneLines(
      [
        { str: 'вторая', x: 5, y: 50 },
        { str: '', x: 5, y: 10 },
        { str: 'правая', x: 60, y: 10.4 },
        { str: 'первая', x: 5, y: 10 },
        { str: '$123456', x: 5, y: 70 },
        { str: 'снаружи', x: 150, y: 10 },
      ],
      zone,
    );
    expect(lines).toEqual(['первая', 'правая', 'вторая']);
  });
});

describe('classifyOpenError', () => {
  it('maps PasswordException to encrypted and anything else to unreadable', () => {
    expect(classifyOpenError({ name: 'PasswordException' }).code).toBe('encrypted');
    expect(classifyOpenError(new Error('boom')).code).toBe('unreadable');
    expect(classifyOpenError(undefined).code).toBe('unreadable');
  });
});

describe('extractShipment (synthetic blank)', () => {
  it('extracts sender, recipient and track', async () => {
    const s = await extractOk(await makeBlank());
    expect(s.templateId).toBe('russian-post-envelope-v1');
    expect(s.sender).toEqual({
      name: DEFAULT_TEXTS.senderName,
      address: DEFAULT_TEXTS.senderAddress,
      index: DEFAULT_TEXTS.senderIndex,
    });
    expect(s.recipient).toEqual({
      name: DEFAULT_TEXTS.recipientName,
      address: DEFAULT_TEXTS.recipientAddress,
      index: DEFAULT_TEXTS.recipientIndex,
    });
    expect(s.trackNumber).toBe(DEFAULT_TEXTS.track);
  });

  it('joins the second address line that starts further left', async () => {
    const s = await extractOk(await makeBlank({ recipientAddressLine2: 'Свердловская' }));
    expect(s.recipient.address).toBe(`${DEFAULT_TEXTS.recipientAddress} Свердловская`);
  });

  it('keeps original bytes usable after extraction', async () => {
    const bytes = await makeBlank();
    const length = bytes.length;
    const s = await extractOk(bytes);
    expect(s.pdfBytes.length).toBe(length);
    expect(bytes.length).toBe(length);
  });

  it('rejects wrong page size as unknown-format', async () => {
    const e = await extractErr(await makeBlank({ pageSize: [595.28, 841.89] }));
    expect(e.code).toBe('unknown-format');
  });

  it('rejects multi-page documents', async () => {
    const e = await extractErr(await makeBlank({ pages: 2 }));
    expect(e.code).toBe('unsupported-pages');
    expect(e.message).toBe('Ожидается одностраничный бланк');
  });

  it('rejects a blank without track number and says what is missing', async () => {
    const e = await extractErr(await makeBlank({ texts: { track: '' } }));
    expect(e.code).toBe('unknown-format');
    expect(e.message).toContain('трек-номер');
  });

  it('rejects a blank whose text is shifted out of the zones', async () => {
    const e = await extractErr(await makeBlank({ shift: { dx: 0, dy: 40 } }));
    expect(e.code).toBe('unknown-format');
  });

  // Review Focus #3
  it('rejects a rotated page as unknown-format', async () => {
    const e = await extractErr(await makeBlank({ rotation: 90 }));
    expect(e.code).toBe('unknown-format');
    expect(e.message).toContain('повёрнута');
  });

  // Review Focus #5
  it('reports garbage, empty and non-PDF bytes as unreadable', async () => {
    expect((await extractErr(new Uint8Array([1, 2, 3]))).code).toBe('unreadable');
    expect((await extractErr(new Uint8Array(0))).code).toBe('unreadable');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const e = await extractErr(png);
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe('Не удалось прочитать файл');
  });
});

describe.skipIf(!realDataAvailable)('extractShipment (real samples in data/)', () => {
  it('matches data/expected.json for every sample', async () => {
    const expected = realExpected();
    const files = realFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const res = await extractShipment(file.name, file.bytes);
      if (!res.ok) throw new Error(`${file.name}: ${res.error.message}`);
      const { sender, recipient, trackNumber } = res.shipment;
      expect({ sender, recipient, trackNumber }).toEqual(expected[file.name]);
    }
  });
});

describe('extractFile', () => {
  it('reports a file that cannot be read as unreadable instead of throwing', async () => {
    const res = await extractFile({ name: 'gone.pdf', arrayBuffer: () => Promise.reject(new Error('NotReadableError')) });
    expect(res).toEqual({ ok: false, fileName: 'gone.pdf', error: { code: 'unreadable', message: 'Не удалось прочитать файл' } });
  });

  it('extracts a readable file', async () => {
    const bytes = await makeBlank();
    const res = await extractFile({ name: 'ok.pdf', arrayBuffer: async () => bytes.slice().buffer });
    expect(res.ok).toBe(true);
  });
});

describe('extractShipment with a shared worker', () => {
  it('loads every document on the given worker and leaves it alive', async () => {
    const worker = new PDFWorker();
    const used = vi.spyOn(worker, 'promise', 'get');
    try {
      for (let i = 0; i < 2; i++) expect((await extractShipment('a.pdf', await makeBlank(), worker)).ok).toBe(true);
      expect(used).toHaveBeenCalled();
      expect(worker.destroyed).toBe(false);
    } finally {
      worker.destroy();
    }
  });
});

describe('extractShipment (page box offset)', () => {
  it('rejects a page whose MediaBox does not start at the origin', async () => {
    const doc = await PDFDocument.load(await makeBlank({ shift: { dx: 20, dy: -20 } }));
    doc.getPage(0).setMediaBox(20, 20, 623.6, 311.8);
    const e = await extractErr(await doc.save());
    expect(e.code).toBe('unknown-format');
  });
});
