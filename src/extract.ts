import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { containsPoint, type Rect } from './geometry';
import { findTemplate, type BlankTemplate } from './template';

export interface Party {
  name: string;
  address: string;
  index: string;
}

export interface Shipment {
  fileName: string;
  templateId: string;
  sender: Party;
  recipient: Party;
  trackNumber: string;
  pdfBytes: Uint8Array;
}

export type ExtractErrorCode = 'unreadable' | 'encrypted' | 'unsupported-pages' | 'unknown-format';

export interface ExtractError {
  code: ExtractErrorCode;
  message: string;
}

export type ExtractResult =
  | { ok: true; shipment: Shipment }
  | { ok: false; fileName: string; error: ExtractError };

/** Текст с началом базовой линии в координатах top-left, pt. */
export interface PositionedText {
  str: string;
  x: number;
  y: number;
}

const MESSAGES: Record<ExtractErrorCode, string> = {
  unreadable: 'Не удалось прочитать файл',
  encrypted: 'Файл защищён паролем',
  'unsupported-pages': 'Ожидается одностраничный бланк',
  'unknown-format': 'Неизвестный формат бланка',
};

function makeError(code: ExtractErrorCode, detail?: string): ExtractError {
  return { code, message: detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code] };
}

export function classifyOpenError(e: unknown): ExtractError {
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  return makeError(name === 'PasswordException' ? 'encrypted' : 'unreadable');
}

export function collectZoneLines(items: PositionedText[], zone: Rect): string[] {
  return items
    .filter((i) => i.str.trim() !== '' && !i.str.startsWith('$') && containsPoint(zone, i.x, i.y))
    .sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x)
    .map((i) => i.str.trim());
}

type Parsed =
  | { ok: true; sender: Party; recipient: Party; trackNumber: string }
  | { ok: false; error: ExtractError };

function parseItems(items: PositionedText[], template: BlankTemplate): Parsed {
  const z = template.zones;
  const text = (zone: Rect) => collectZoneLines(items, zone).join(' ');
  const sender: Party = { name: text(z.senderName), address: text(z.senderAddress), index: text(z.senderIndex) };
  const recipient: Party = {
    name: text(z.recipientName),
    address: text(z.recipientAddress),
    index: text(z.recipientIndex),
  };
  const trackNumber = text(z.track).replace(/\s/g, '');

  const missing: string[] = [];
  if (!/^\d{14}$/.test(trackNumber)) missing.push('трек-номер');
  if (!sender.name) missing.push('отправитель');
  if (!/^\d{6}$/.test(sender.index)) missing.push('индекс отправителя');
  if (!recipient.name) missing.push('получатель');
  if (!/^\d{6}$/.test(recipient.index)) missing.push('индекс получателя');
  if (missing.length) return { ok: false, error: makeError('unknown-format', `не найдено: ${missing.join(', ')}`) };
  return { ok: true, sender, recipient, trackNumber };
}

export async function extractShipment(fileName: string, bytes: Uint8Array): Promise<ExtractResult> {
  const fail = (error: ExtractError): ExtractResult => ({ ok: false, fileName, error });

  // pdf.js забирает переданный буфер — отдаём копию, оригинал нужен для render.
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    return fail(classifyOpenError(e));
  }

  try {
    if (doc.numPages !== 1) return fail(makeError('unsupported-pages'));
    const page = await doc.getPage(1);
    if (page.rotate % 360 !== 0) return fail(makeError('unknown-format', 'страница повёрнута'));

    const [x0, y0, x1, y1] = page.view;
    const width = x1 - x0;
    const height = y1 - y0;
    const template = findTemplate(width, height);
    if (!template) {
      return fail(makeError('unknown-format', `размер страницы ${Math.round(width)}×${Math.round(height)} pt`));
    }

    const content = await page.getTextContent();
    const items: PositionedText[] = content.items.flatMap((item) =>
      'str' in item ? [{ str: item.str, x: item.transform[4] - x0, y: y1 - item.transform[5] }] : [],
    );

    const parsed = parseItems(items, template);
    if (!parsed.ok) return fail(parsed.error);
    return {
      ok: true,
      shipment: {
        fileName,
        templateId: template.id,
        sender: parsed.sender,
        recipient: parsed.recipient,
        trackNumber: parsed.trackNumber,
        pdfBytes: bytes,
      },
    };
  } catch (e) {
    return fail(classifyOpenError(e));
  } finally {
    await task.destroy();
  }
}
