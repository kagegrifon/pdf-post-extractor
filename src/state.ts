import type { ExtractResult, Shipment } from './extract';

export type EntryStatus = 'pending' | 'ok' | 'error';

export interface FileEntry {
  id: string;
  fileName: string;
  status: EntryStatus;
  shipment?: Shipment;
  error?: string;
}

export function addPending(entries: FileEntry[], files: { id: string; fileName: string }[]): FileEntry[] {
  return [...entries, ...files.map((f) => ({ id: f.id, fileName: f.fileName, status: 'pending' as const }))];
}

export function resolveEntry(entries: FileEntry[], id: string, result: ExtractResult): FileEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e;
    return result.ok
      ? { ...e, status: 'ok' as const, shipment: result.shipment, error: undefined }
      : { ...e, status: 'error' as const, shipment: undefined, error: result.error.message };
  });
}

export function removeEntry(entries: FileEntry[], id: string): FileEntry[] {
  return entries.filter((e) => e.id !== id);
}

export function moveEntry(entries: FileEntry[], fromId: string, toId: string): FileEntry[] {
  const from = entries.findIndex((e) => e.id === fromId);
  const to = entries.findIndex((e) => e.id === toId);
  if (from < 0 || to < 0 || from === to) return entries;
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function duplicateTracks(entries: FileEntry[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const e of entries) {
    const track = e.status === 'ok' ? e.shipment?.trackNumber : undefined;
    if (!track) continue;
    if (seen.has(track)) dups.add(track);
    seen.add(track);
  }
  return dups;
}

export function readyShipments(entries: FileEntry[]): Shipment[] {
  return entries.flatMap((e) => (e.status === 'ok' && e.shipment ? [e.shipment] : []));
}
