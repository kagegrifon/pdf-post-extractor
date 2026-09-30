import type { Rect } from './geometry';

export type ZoneName =
  | 'senderName'
  | 'senderAddress'
  | 'senderIndex'
  | 'recipientName'
  | 'recipientAddress'
  | 'recipientIndex'
  | 'track';

export interface BlankTemplate {
  id: string;
  /** pt */
  pageSize: { width: number; height: number };
  /** Зоны проверяются по точке начала базовой линии текста. */
  zones: Record<ZoneName, Rect>;
  /** Вырезаемый фрагмент: QR, марка, штрихкод, трек и поле тишины. */
  crop: Rect;
}

export const PAGE_SIZE_TOLERANCE = 1;

export const RUSSIAN_POST_ENVELOPE: BlankTemplate = {
  id: 'russian-post-envelope-v1',
  pageSize: { width: 623.6, height: 311.8 },
  zones: {
    senderName: { x: 30, y: 5, width: 300, height: 39 },
    senderAddress: { x: 30, y: 44, width: 300, height: 51 },
    senderIndex: { x: 150, y: 95, width: 180, height: 30 },
    track: { x: 400, y: 145, width: 170, height: 20 },
    recipientName: { x: 330, y: 166, width: 293.6, height: 33 },
    recipientAddress: { x: 330, y: 199, width: 293.6, height: 63 },
    recipientIndex: { x: 340, y: 265, width: 283.6, height: 35 },
  },
  crop: { x: 366, y: 8, width: 218, height: 158 },
};

export const TEMPLATES: BlankTemplate[] = [RUSSIAN_POST_ENVELOPE];

export function findTemplate(width: number, height: number): BlankTemplate | undefined {
  return TEMPLATES.find(
    (t) =>
      Math.abs(t.pageSize.width - width) <= PAGE_SIZE_TOLERANCE &&
      Math.abs(t.pageSize.height - height) <= PAGE_SIZE_TOLERANCE,
  );
}

export function getTemplate(id: string): BlankTemplate {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Неизвестный шаблон бланка: ${id}`);
  return template;
}
