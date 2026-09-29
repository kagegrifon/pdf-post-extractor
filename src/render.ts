import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Shipment } from './extract';
import type { Rect } from './geometry';
import { layoutPages, type Size } from './layout';
import type { LayoutPreset } from './presets';
import { getTemplate } from './template';
import { fitParagraphs, sanitizeText } from './textwrap';

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

function fragmentSize(shipments: Shipment[]): Size {
  return shipments.reduce<Size>(
    (acc, s) => {
      const { crop } = getTemplate(s.templateId);
      return { width: Math.max(acc.width, crop.width), height: Math.max(acc.height, crop.height) };
    },
    { width: 0, height: 0 },
  );
}

/** Фрагмент исходной страницы как Form XObject — исходные потоки картинок, без растеризации. */
async function embedFragment(out: PDFDocument, s: Shipment): Promise<PDFEmbeddedPage> {
  const { crop } = getTemplate(s.templateId);
  const src = await PDFDocument.load(s.pdfBytes);
  const page = src.getPage(0);
  const h = page.getHeight();
  return out.embedPage(page, {
    left: crop.x,
    right: crop.x + crop.width,
    top: h - crop.y,
    bottom: h - crop.y - crop.height,
  });
}

/** Нижняя граница прямоугольника в координатах PDF (начало внизу). */
function pdfBottom(page: PDFPage, r: Rect): number {
  return page.getHeight() - r.y - r.height;
}

function drawCellText(page: PDFPage, font: PDFFont, fontSize: number, r: Rect, paragraphs: string[]): void {
  const lineHeight = fontSize * LINE_HEIGHT;
  const maxLines = Math.floor(r.height / lineHeight);
  const measure = (t: string) => font.widthOfTextAtSize(t, fontSize);
  const lines = fitParagraphs(paragraphs, r.width, maxLines, measure);
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
  const fragments = await Promise.all(shipments.map((s) => embedFragment(out, s)));

  for (const layout of pages) {
    const page = out.addPage([layout.width, layout.height]);
    for (const cell of layout.cells) {
      const s = shipments[cell.index];
      const f = cell.fragment;
      page.drawPage(fragments[cell.index], {
        x: f.x,
        y: pdfBottom(page, f),
        xScale: preset.fragmentScale,
        yScale: preset.fragmentScale,
      });
      page.drawRectangle({
        x: f.x,
        y: pdfBottom(page, f),
        width: f.width,
        height: f.height,
        borderColor: CUT_LINE_COLOR,
        borderWidth: 0.5,
        borderDashArray: [3, 3],
      });
      if (preset.printNumberOnFragment) {
        // Левый нижний угол вырезки пуст (штрихкод начинается на 40 pt правее) — вне поля тишины.
        page.drawText(String(cell.index + 1), {
          x: f.x + 2,
          y: pdfBottom(page, f) + 2,
          size: FRAGMENT_NUMBER_SIZE,
          font,
          color: NUMBER_COLOR,
        });
      }
      drawCellText(page, font, preset.fontSize, cell.text, cellParagraphs(cell.index + 1, s).map(clean));
    }
  }
  return out.save();
}
