import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { degrees, PDFDocument } from 'pdf-lib';

export const ROBOTO_PATH = path.resolve('node_modules/roboto-fontface/fonts/roboto/Roboto-Regular.woff');

export type BlankField =
  | 'senderName'
  | 'senderAddress'
  | 'senderIndex'
  | 'recipientName'
  | 'recipientAddress'
  | 'recipientIndex'
  | 'track';

export const DEFAULT_TEXTS: Record<BlankField, string> = {
  senderName: 'ООО "Тест-Отправитель"',
  senderAddress: 'г. Тестовск, ул. Первая, д. 1',
  senderIndex: '101000',
  recipientName: 'ИП Проверкин',
  recipientAddress: 'г. Примерск, пр. Второй, д. 2',
  recipientIndex: '202000',
  track: '12345678901234',
};

/** Начало базовой линии (top-left, pt) и кегль — как в реальных бланках. */
const POSITIONS: Record<BlankField, { x: number; y: number; size: number }> = {
  senderName: { x: 53, y: 21.8, size: 11 },
  senderAddress: { x: 53, y: 60.8, size: 11 },
  senderIndex: { x: 190, y: 114.8, size: 13 },
  recipientName: { x: 367, y: 177.3, size: 11 },
  recipientAddress: { x: 367, y: 215.8, size: 11 },
  recipientIndex: { x: 383, y: 289.8, size: 13 },
  track: { x: 433.6, y: 160.5, size: 11.3 },
};

export interface BlankSpec {
  pageSize?: [number, number];
  pages?: number;
  rotation?: number;
  texts?: Partial<Record<BlankField, string>>;
  /** Вторая строка адреса получателя, как в реальном образце (x 342, y 234.5). */
  recipientAddressLine2?: string;
  /** Сдвинуть все тексты (имитация другой версии генератора). */
  shift?: { dx: number; dy: number };
}

export async function makeBlank(spec: BlankSpec = {}): Promise<Uint8Array> {
  const [width, height] = spec.pageSize ?? [623.6, 311.8];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(ROBOTO_PATH), { subset: true });
  const pages = Array.from({ length: spec.pages ?? 1 }, () => doc.addPage([width, height]));
  const page = pages[0];
  if (spec.rotation) page.setRotation(degrees(spec.rotation));
  const dx = spec.shift?.dx ?? 0;
  const dy = spec.shift?.dy ?? 0;
  const texts = { ...DEFAULT_TEXTS, ...spec.texts };
  const draw = (text: string, x: number, y: number, size: number) =>
    page.drawText(text, { x: x + dx, y: height - (y + dy), size, font });

  for (const field of Object.keys(POSITIONS) as BlankField[]) {
    const text = texts[field];
    if (!text) continue;
    const p = POSITIONS[field];
    draw(text, p.x, p.y, p.size);
  }
  if (spec.recipientAddressLine2) draw(spec.recipientAddressLine2, 342, 234.5, 11);
  // Дубль индекса получателя крупным шрифтом, как PostIndex в оригинале.
  if (texts.recipientIndex) draw(`$${texts.recipientIndex}`, 25, 279.8, 48);
  return doc.save();
}
