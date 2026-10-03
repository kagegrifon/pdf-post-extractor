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
  /** Вырезаемые фрагменты (QR, марка, штрихкод, трек) вместе с полем тишины; на листе идут сверху вниз. */
  crops: Rect[];
  /** Индекс вырезки, у которой левый нижний угол пуст и вне поля тишины, — туда печатается номер. */
  numberedCrop: number;
}

export const PAGE_SIZE_TOLERANCE = 1;
/** pt между вырезками одного отправления — место под рез. */
export const CROP_GAP = 6;

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
  crops: [{ x: 366, y: 8, width: 218, height: 158 }],
  numberedCrop: 0,
};

/** Бандероль ф.7-б на A5: марка с QR вверху справа и ITF-штрихкод в блоке оператора — две отдельные вырезки. */
export const RUSSIAN_POST_F7B: BlankTemplate = {
  id: 'russian-post-f7b-v1',
  pageSize: { width: 419.53, height: 595.28 },
  zones: {
    senderName: { x: 12, y: 120, width: 190, height: 20 },
    senderAddress: { x: 12, y: 140, width: 190, height: 40 },
    senderIndex: { x: 120, y: 190, width: 85, height: 25 },
    recipientName: { x: 215, y: 120, width: 200, height: 20 },
    recipientAddress: { x: 215, y: 140, width: 200, height: 40 },
    recipientIndex: { x: 325, y: 190, width: 90, height: 25 },
    track: { x: 10, y: 274, width: 145, height: 15 },
  },
  crops: [
    // Марка: картинка 240.7…407.2 × 25.6…85.1, QR без собственного поля тишины. Ниже на y≈91 — рамка блока сумм.
    { x: 230, y: 16, width: 182, height: 73 },
    // Штрихкод: полосы 14.8…144.5 × 250…273, цифры трека под ними. Справа на x≈162 — чекбоксы.
    { x: 2, y: 243, width: 155, height: 46 },
  ],
  numberedCrop: 1,
};

export const TEMPLATES: BlankTemplate[] = [RUSSIAN_POST_ENVELOPE, RUSSIAN_POST_F7B];

export interface PlacedCrop {
  crop: Rect;
  /** Смещение левого верхнего угла вырезки внутри фрагмента, pt без масштаба. */
  x: number;
  y: number;
}

/** Вырезки шаблона, сложенные столбиком и выровненные по правому краю, и размер получившегося фрагмента. */
export function stackCrops(template: BlankTemplate): { width: number; height: number; pieces: PlacedCrop[] } {
  const width = Math.max(...template.crops.map((c) => c.width));
  let y = 0;
  const pieces = template.crops.map((crop) => {
    const piece = { crop, x: width - crop.width, y };
    y += crop.height + CROP_GAP;
    return piece;
  });
  return { width, height: y - CROP_GAP, pieces };
}

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
