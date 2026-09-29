import { describe, expect, it } from 'vitest';
import type { ExtractResult, Shipment } from '../src/extract';
import {
  addPending,
  duplicateTracks,
  moveEntry,
  readyShipments,
  removeEntry,
  resolveEntry,
  type FileEntry,
} from '../src/state';

function shipment(track: string): Shipment {
  const party = { name: 'n', address: 'a', index: '000000' };
  return { fileName: `${track}.pdf`, templateId: 't', sender: party, recipient: party, trackNumber: track, pdfBytes: new Uint8Array() };
}
const ok = (track: string): ExtractResult => ({ ok: true, shipment: shipment(track) });
const bad: ExtractResult = { ok: false, fileName: 'x.pdf', error: { code: 'unreadable', message: 'Не удалось прочитать файл' } };

function seed(): FileEntry[] {
  return addPending([], [
    { id: 'a', fileName: 'a.pdf' },
    { id: 'b', fileName: 'b.pdf' },
    { id: 'c', fileName: 'c.pdf' },
  ]);
}

describe('state', () => {
  it('addPending appends entries with pending status', () => {
    const entries = seed();
    expect(entries.map((e) => [e.id, e.status])).toEqual([['a', 'pending'], ['b', 'pending'], ['c', 'pending']]);
    expect(addPending(entries, [{ id: 'd', fileName: 'd.pdf' }]).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('resolveEntry stores shipment or error message', () => {
    let entries = resolveEntry(seed(), 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', bad);
    expect(entries[0]).toMatchObject({ status: 'ok', shipment: { trackNumber: '11111111111111' } });
    expect(entries[1]).toMatchObject({ status: 'error', error: 'Не удалось прочитать файл' });
    expect(entries[2].status).toBe('pending');
  });

  // Review Focus #4
  it('resolveEntry for a removed entry does not bring it back', () => {
    const entries = resolveEntry(removeEntry(seed(), 'b'), 'b', ok('22222222222222'));
    expect(entries.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('moveEntry moves an entry to the position of the target', () => {
    expect(moveEntry(seed(), 'c', 'a').map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(moveEntry(seed(), 'a', 'c').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(moveEntry(seed(), 'a', 'a').map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(moveEntry(seed(), 'zzz', 'a').map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('duplicateTracks finds tracks used by more than one ok entry', () => {
    let entries = resolveEntry(seed(), 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', ok('11111111111111'));
    entries = resolveEntry(entries, 'c', ok('33333333333333'));
    expect([...duplicateTracks(entries)]).toEqual(['11111111111111']);
  });

  it('readyShipments returns ok shipments in list order', () => {
    let entries = resolveEntry(seed(), 'c', ok('33333333333333'));
    entries = resolveEntry(entries, 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', bad);
    expect(readyShipments(entries).map((s) => s.trackNumber)).toEqual(['11111111111111', '33333333333333']);
  });
});
