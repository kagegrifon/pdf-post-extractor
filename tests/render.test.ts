import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, type PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractShipment, type Shipment } from '../src/extract';
import { LayoutError } from '../src/layout';
import { getPreset } from '../src/presets';
import { cellLines, cellParagraphs, renderSheet, sheetFileName } from '../src/render';
import { makeBlank, ROBOTO_PATH } from './fixtures/makeBlank';
import { decodePages } from './helpers/rasterize';
import { realDataAvailable, realFiles } from './helpers/realData';

const fontBytes = new Uint8Array(fs.readFileSync(ROBOTO_PATH));
const landscape = getPreset('a4-landscape-2');

async function syntheticShipment(overrides: Parameters<typeof makeBlank>[0] = {}): Promise<Shipment> {
  const res = await extractShipment('synthetic.pdf', await makeBlank(overrides));
  if (!res.ok) throw new Error(res.error.message);
  return res.shipment;
}

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join('\n'));
  }
  await task.destroy();
  return pages;
}

function images(doc: PDFDocument): { width: number; height: number; filter: string; contents: Uint8Array }[] {
  const out: { width: number; height: number; filter: string; contents: Uint8Array }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    out.push({
      width: (obj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
      height: (obj.dict.get(PDFName.of('Height')) as PDFNumber).asNumber(),
      filter: String(obj.dict.get(PDFName.of('Filter'))),
      contents: obj.contents,
    });
  }
  return out;
}

describe('helpers', () => {
  it('sheetFileName uses local date', () => {
    expect(sheetFileName(new Date(2026, 8, 29, 23, 59))).toBe('otpravleniya-2026-09-29.pdf');
  });

  it('cellParagraphs lists number, track, sender and recipient', async () => {
    const s = await syntheticShipment();
    expect(cellParagraphs(3, s)).toEqual([
      '№ 3   12345678901234',
      'От кого: ООО "Тест-Отправитель"',
      'г. Тестовск, ул. Первая, д. 1, 101000',
      'Кому: ИП Проверкин',
      'г. Примерск, пр. Второй, д. 2, 202000',
    ]);
  });
});

describe('cellLines', () => {
  const byLength = (t: string) => t.length;
  const words = (n: number, w: string) => Array(n).fill(w).join(' ');

  it('keeps everything when it fits', () => {
    expect(cellLines(['H', 's1', 's2', 'r1', 'r2'], 10, 10, byLength)).toEqual(['H', 's1', 's2', 'r1', 'r2']);
  });

  it('a long sender gets only the space the recipient does not need', () => {
    const lines = cellLines(['H', words(20, 'ss'), 's', 'rr', 'r'], 2, 10, byLength);
    expect(lines).toHaveLength(10);
    expect(lines.slice(-2)).toEqual(['rr', 'r']);
    expect(lines[7]).toBe('s…');
  });

  it('when both are long, each side gets half of the remaining lines', () => {
    const lines = cellLines(['H', words(20, 'ss'), 's', words(20, 'rr'), 'r'], 2, 9, byLength);
    expect(lines).toEqual(['H', 'ss', 'ss', 'ss', 's…', 'rr', 'rr', 'rr', 'r…']);
  });
});

describe('renderSheet (synthetic)', () => {
  it('rejects an empty list', async () => {
    await expect(renderSheet({ shipments: [], preset: landscape, fontBytes })).rejects.toThrow('Нет отправлений');
  });

  it('propagates LayoutError for an impossible preset', async () => {
    const s = await syntheticShipment();
    const bad = { ...landscape, columns: 4 };
    await expect(renderSheet({ shipments: [s], preset: bad, fontBytes })).rejects.toBeInstanceOf(LayoutError);
  });

  it('puts 7 shipments on 2 landscape A4 pages with the table text', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: Array(7).fill(s), preset: landscape, fontBytes });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
    const [first, second] = await pdfText(bytes);
    expect(first).toContain('Кому: ИП Проверкин');
    expect(first).toContain('№ 6');
    expect(second).toContain('№ 7');
  });

  it('sets title with date', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: [s], preset: landscape, fontBytes, date: new Date(2026, 8, 29) });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Отправления 2026-09-29');
  });

  // Review Focus #1 и #2
  it('handles very long names and glyphs missing from the font', async () => {
    const long = 'Общество с ограниченной ответственностью "Очень Длинное Название 😀" '.repeat(6);
    const base = await syntheticShipment();
    const s: Shipment = { ...base, recipient: { ...base.recipient, name: long } };
    const bytes = await renderSheet({ shipments: [s], preset: landscape, fontBytes });
    const [text] = await pdfText(bytes);
    expect(text).toContain('…');
    expect(text).toContain('?');
    expect(text).not.toContain('😀');
  });

  it('a very long sender never pushes the recipient out of the landscape cell', async () => {
    const base = await syntheticShipment();
    const sender = {
      ...base.sender,
      name: 'Федеральное государственное унитарное предприятие "Научно-производственное предприятие" '.repeat(2),
      address: 'Российская Федерация, Свердловская область, город Тестовск, улица Очень Длинная, дом 1, корпус 2, '.repeat(3),
    };
    const bytes = await renderSheet({ shipments: [{ ...base, sender }], preset: landscape, fontBytes });
    const [text] = await pdfText(bytes);
    expect(text).toContain('Кому: ИП Проверкин');
    expect(text).toContain('202000');
    expect(text).toContain('…');
  });

  it('f7b fragments (mark + barcode stacked) are lower, so 8 fit on a landscape page', async () => {
    const s = await syntheticShipment({ format: 'f7b' });
    const page = async (n: number) =>
      (await PDFDocument.load(await renderSheet({ shipments: Array(n).fill(s), preset: landscape, fontBytes }))).getPageCount();
    expect(await page(8)).toBe(1);
    expect(await page(9)).toBe(2);
  });

  it('a mixed batch uses the larger envelope cell', async () => {
    const env = await syntheticShipment();
    const f7b = await syntheticShipment({ format: 'f7b' });
    const shipments = [env, f7b, env, f7b, env, f7b, env];
    const bytes = await renderSheet({ shipments, preset: landscape, fontBytes });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('renders a batch of 60 shipments into 10 pages', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: Array(60).fill(s), preset: landscape, fontBytes });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(10);
  });
});

describe.skipIf(!realDataAvailable)('renderSheet (real samples) — quality', () => {
  async function realShipments(): Promise<Shipment[]> {
    const out: Shipment[] = [];
    for (const f of realFiles()) {
      const res = await extractShipment(f.name, f.bytes);
      if (!res.ok) throw new Error(`${f.name}: ${res.error.message}`);
      out.push(res.shipment);
    }
    return out;
  }

  it('embeds the original barcode and QR image streams byte-for-byte', async () => {
    const shipments = await realShipments();
    const out = await PDFDocument.load(await renderSheet({ shipments, preset: landscape, fontBytes }));
    const outImages = images(out);
    for (const s of shipments) {
      const src = images(await PDFDocument.load(s.pdfBytes));
      for (const img of src.filter((i) => (i.width === 848 && i.height === 1) || (i.width === 980 && i.height === 350))) {
        const match = outImages.find(
          (o) => o.width === img.width && o.height === img.height && Buffer.from(o.contents).equals(Buffer.from(img.contents)),
        );
        expect(match, `${s.fileName}: image ${img.width}x${img.height} not preserved`).toBeDefined();
        expect(match!.filter).toBe('/FlateDecode');
      }
    }
  });

  it('every fragment decodes at 300 dpi: ITF = track, QR mentions the track', async () => {
    const shipments = await realShipments();
    for (const preset of [getPreset('a4-landscape-2'), getPreset('a4-portrait-1')]) {
      const bytes = await renderSheet({ shipments, preset, fontBytes });
      const decoded = (await decodePages(bytes)).flat();
      const itf = decoded.filter((d) => d.format === 'ITF').map((d) => d.text).sort();
      expect(itf, preset.id).toEqual(shipments.map((s) => s.trackNumber).sort());
      for (const s of shipments) {
        expect(decoded.some((d) => d.format === 'QRCode' && d.text.includes(`Barcode: ${s.trackNumber}`)), preset.id).toBe(true);
      }
    }
  });
});
