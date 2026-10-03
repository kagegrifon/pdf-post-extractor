import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Shipment } from './extract';
import type { Rect } from './geometry';
import { layoutPages, type Size } from './layout';
import type { LayoutPreset } from './presets';
import { getTemplate, stackCrops } from './template';
import { fitParagraphs, sanitizeText, type Measure } from './textwrap';

export interface RenderInput {
  shipments: Shipment[];
  preset: LayoutPreset;
  fontBytes: Uint8Array;
  date?: Date;
}

export const LINE_HEIGHT = 1.25;
export const FRAGMENT_NUMBER_SIZE = 6;
const CUT_LINE_COLOR = rgb(0.6, 0.6, 0.6);
const NUMBER_COLOR = rgb(0.35, 0.35, 0.35);

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sheetFileName(d: Date): string {
  return `otpravleniya-${formatDate(d)}.pdf`;
}

export function cellParagraphs(number: number, s: Shipment): string[] {
  return [
    `№ ${number}   ${s.trackNumber}`,
    `От кого: ${s.sender.name}`,
    `${s.sender.address}, ${s.sender.index}`,
    `Кому: ${s.recipient.name}`,
    `${s.recipient.address}, ${s.recipient.index}`,
  ];
}

/**
 * Строки ячейки: заголовок (1 строка), отправитель, получатель. Отправитель занимает не больше половины
 * оставшихся строк, иначе длинные реквизиты отправителя вытесняют получателя из ячейки.
 */
export function cellLines(paragraphs: string[], maxWidth: number, maxLines: number, measure: Measure): string[] {
  const [header, ...rest] = paragraphs;
  const sender = rest.slice(0, 2);
  const recipient = rest.slice(2);
  const head = fitParagraphs([header], maxWidth, Math.min(1, maxLines), measure);
  const left = maxLines - head.length;
  const senderNeeds = fitParagraphs(sender, maxWidth, left, measure).length;
  const senderLines = fitParagraphs(sender, maxWidth, Math.min(senderNeeds, Math.floor(left / 2)), measure);
  const recipientLines = fitParagraphs(recipient, maxWidth, left - senderLines.length, measure);
  if (recipientLines.length + senderLines.length < left && senderLines.length < senderNeeds) {
    // Получателю хватило места — отдаём остаток отправителю.
    return [...head, ...fitParagraphs(sender, maxWidth, left - recipientLines.length, measure), ...recipientLines];
  }
  return [...head, ...senderLines, ...recipientLines];
}

function fragmentSize(shipments: Shipment[]): Size {
  return shipments.reduce<Size>(
    (acc, s) => {
      const stack = stackCrops(getTemplate(s.templateId));
      return { width: Math.max(acc.width, stack.width), height: Math.max(acc.height, stack.height) };
    },
    { width: 0, height: 0 },
  );
}

/** Вырезки исходной страницы как Form XObject — исходные потоки картинок, без растеризации. */
async function embedFragments(out: PDFDocument, s: Shipment): Promise<PDFEmbeddedPage[]> {
  const { crops } = getTemplate(s.templateId);
  const src = await PDFDocument.load(s.pdfBytes);
  const page = src.getPage(0);
  const h = page.getHeight();
  return Promise.all(
    crops.map((crop) =>
      out.embedPage(page, {
        left: crop.x,
        right: crop.x + crop.width,
        top: h - crop.y,
        bottom: h - crop.y - crop.height,
      }),
    ),
  );
}

/** Нижняя граница прямоугольника в координатах PDF (начало внизу). */
function pdfBottom(page: PDFPage, r: Rect): number {
  return page.getHeight() - r.y - r.height;
}

function drawCellText(page: PDFPage, font: PDFFont, fontSize: number, r: Rect, paragraphs: string[]): void {
  const lineHeight = fontSize * LINE_HEIGHT;
  const maxLines = Math.floor(r.height / lineHeight);
  const measure = (t: string) => font.widthOfTextAtSize(t, fontSize);
  const lines = cellLines(paragraphs, r.width, maxLines, measure);
  lines.forEach((line, i) => {
    page.drawText(line, { x: r.x, y: page.getHeight() - r.y - fontSize - i * lineHeight, size: fontSize, font });
  });
}

export async function renderSheet({ shipments, preset, fontBytes, date = new Date() }: RenderInput): Promise<Uint8Array> {
  if (shipments.length === 0) throw new Error('Нет отправлений для печати');
  const pages = layoutPages(shipments.length, preset, fragmentSize(shipments));

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  out.setTitle(`Отправления ${formatDate(date)}`);
  const font = await out.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const clean = (t: string) => sanitizeText(t, supported);
  const fragments = await Promise.all(shipments.map((s) => embedFragments(out, s)));

  for (const layout of pages) {
    const page = out.addPage([layout.width, layout.height]);
    for (const cell of layout.cells) {
      const s = shipments[cell.index];
      const f = cell.fragment;
      const template = getTemplate(s.templateId);
      const stack = stackCrops(template);
      const scale = preset.fragmentScale;
      // Ячейка рассчитана на самый крупный фрагмент пачки — свой прижимаем к правому верхнему углу.
      const left = f.x + f.width - stack.width * scale;
      stack.pieces.forEach((piece, i) => {
        const r: Rect = {
          x: left + piece.x * scale,
          y: f.y + piece.y * scale,
          width: piece.crop.width * scale,
          height: piece.crop.height * scale,
        };
        page.drawPage(fragments[cell.index][i], { x: r.x, y: pdfBottom(page, r), xScale: scale, yScale: scale });
        page.drawRectangle({
          x: r.x,
          y: pdfBottom(page, r),
          width: r.width,
          height: r.height,
          borderColor: CUT_LINE_COLOR,
          borderWidth: 0.5,
          borderDashArray: [3, 3],
        });
        if (preset.printNumberOnFragment && i === template.numberedCrop) {
          // Левый нижний угол этой вырезки пуст и лежит вне поля тишины (см. template.ts).
          page.drawText(String(cell.index + 1), {
            x: r.x + 2,
            y: pdfBottom(page, r) + 2,
            size: FRAGMENT_NUMBER_SIZE,
            font,
            color: NUMBER_COLOR,
          });
        }
      });
      drawCellText(page, font, preset.fontSize, cell.text, cellParagraphs(cell.index + 1, s).map(clean));
    }
  }
  return out.save();
}
