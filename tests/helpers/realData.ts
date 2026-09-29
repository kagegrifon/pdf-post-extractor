import fs from 'node:fs';
import path from 'node:path';
import type { Party } from '../../src/extract';

const DATA_DIR = path.resolve('data');
const EXPECTED_PATH = path.join(DATA_DIR, 'expected.json');

export const realDataAvailable = fs.existsSync(EXPECTED_PATH);

export function realFiles(): { name: string; bytes: Uint8Array }[] {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(DATA_DIR, name))) }));
}

export function realExpected(): Record<string, { sender: Party; recipient: Party; trackNumber: string }> {
  return JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
}
