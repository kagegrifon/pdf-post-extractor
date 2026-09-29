import { mmToPt, type Rect } from './geometry';
import type { LayoutPreset } from './presets';

export interface Size {
  width: number;
  height: number;
}

/** Все размеры в pt. */
export interface Grid {
  columns: number;
  rows: number;
  perPage: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  gap: number;
  cellWidth: number;
  cellHeight: number;
  fragmentWidth: number;
  fragmentHeight: number;
  textWidth: number;
}

export interface CellLayout {
  /** Сквозной номер отправления, с 0. */
  index: number;
  cell: Rect;
  text: Rect;
  fragment: Rect;
}

export interface PageLayout {
  width: number;
  height: number;
  cells: CellLayout[];
}

export class LayoutError extends Error {}

export const MIN_TEXT_WIDTH_MM = 30;

const EPSILON = 1e-6;

export function computeGrid(preset: LayoutPreset, fragment: Size): Grid {
  const pageWidth = mmToPt(preset.page.width);
  const pageHeight = mmToPt(preset.page.height);
  const margin = mmToPt(preset.margins);
  const gap = mmToPt(preset.cellGap);
  const textGap = mmToPt(preset.textGap);
  const fragmentWidth = fragment.width * preset.fragmentScale;
  const fragmentHeight = fragment.height * preset.fragmentScale;

  const usableWidth = pageWidth - 2 * margin;
  const usableHeight = pageHeight - 2 * margin;
  const columns = preset.columns;
  const cellWidth = (usableWidth - gap * (columns - 1)) / columns;
  const cellHeight = fragmentHeight;
  const rows = Math.floor((usableHeight + gap + EPSILON) / (cellHeight + gap));
  const textWidth = cellWidth - fragmentWidth - textGap;

  if (rows < 1) throw new LayoutError(`Фрагмент не помещается по высоте в раскладку «${preset.title}»`);
  if (textWidth < mmToPt(MIN_TEXT_WIDTH_MM)) {
    throw new LayoutError(`Слишком узкая колонка текста в раскладке «${preset.title}»`);
  }

  return {
    columns,
    rows,
    perPage: columns * rows,
    pageWidth,
    pageHeight,
    margin,
    gap,
    cellWidth,
    cellHeight,
    fragmentWidth,
    fragmentHeight,
    textWidth,
  };
}

export function layoutPages(count: number, preset: LayoutPreset, fragment: Size): PageLayout[] {
  if (count <= 0) return [];
  const g = computeGrid(preset, fragment);
  const pages: PageLayout[] = [];

  for (let index = 0; index < count; index++) {
    const slot = index % g.perPage;
    if (slot === 0) pages.push({ width: g.pageWidth, height: g.pageHeight, cells: [] });
    const row = Math.floor(slot / g.columns);
    const col = slot % g.columns;
    const x = g.margin + col * (g.cellWidth + g.gap);
    const y = g.margin + row * (g.cellHeight + g.gap);
    pages[pages.length - 1].cells.push({
      index,
      cell: { x, y, width: g.cellWidth, height: g.cellHeight },
      text: { x, y, width: g.textWidth, height: g.cellHeight },
      fragment: { x: x + g.cellWidth - g.fragmentWidth, y, width: g.fragmentWidth, height: g.fragmentHeight },
    });
  }
  return pages;
}
