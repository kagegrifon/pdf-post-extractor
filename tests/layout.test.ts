import { describe, expect, it } from 'vitest';
import { mmToPt } from '../src/geometry';
import { computeGrid, layoutPages, LayoutError } from '../src/layout';
import { DEFAULT_PRESET_ID, getPreset, PRESETS, type LayoutPreset } from '../src/presets';

const FRAGMENT = { width: 218, height: 158 };
const landscape = getPreset('a4-landscape-2');
const portrait = getPreset('a4-portrait-1');

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('presets', () => {
  it('default preset exists and ids are unique', () => {
    expect(getPreset(DEFAULT_PRESET_ID).id).toBe('a4-landscape-2');
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(() => getPreset('nope')).toThrow();
  });
});

describe('computeGrid', () => {
  it('landscape A4 fits 2 columns x 3 rows with ~60mm text column', () => {
    const g = computeGrid(landscape, FRAGMENT);
    expect([g.columns, g.rows, g.perPage]).toEqual([2, 3, 6]);
    expect(g.textWidth).toBeGreaterThan(mmToPt(59));
    expect(g.textWidth).toBeLessThan(mmToPt(60.5));
  });

  it('portrait A4 fits 1 column x 5 rows', () => {
    const g = computeGrid(portrait, FRAGMENT);
    expect([g.columns, g.rows, g.perPage]).toEqual([1, 5, 5]);
  });

  it('smaller fragmentScale gives more rows', () => {
    const g = computeGrid({ ...portrait, fragmentScale: 0.5 }, FRAGMENT);
    expect(g.rows).toBeGreaterThan(5);
    expect(g.fragmentHeight).toBeCloseTo(79, 6);
  });

  it('throws LayoutError when fragment does not fit vertically', () => {
    expect(() => computeGrid(landscape, { width: 218, height: 1000 })).toThrow(LayoutError);
  });

  it('throws LayoutError when text column is too narrow', () => {
    const narrow: LayoutPreset = { ...portrait, columns: 2 };
    expect(() => computeGrid(narrow, FRAGMENT)).toThrow(LayoutError);
  });
});

describe('layoutPages', () => {
  it('returns no pages for zero shipments', () => {
    expect(layoutPages(0, landscape, FRAGMENT)).toEqual([]);
  });

  it.each([
    [1, [1]],
    [6, [6]],
    [7, [6, 1]],
    [13, [6, 6, 1]],
  ])('%i shipments -> cells per page %j', (count, perPage) => {
    const pages = layoutPages(count, landscape, FRAGMENT);
    expect(pages.map((p) => p.cells.length)).toEqual(perPage);
    expect(pages.flatMap((p) => p.cells.map((c) => c.index))).toEqual([...Array(count).keys()]);
  });

  it('fills rows left-to-right, then top-to-bottom', () => {
    const [page] = layoutPages(3, landscape, FRAGMENT);
    const [a, b, c] = page.cells;
    expect(a.cell.y).toBeCloseTo(b.cell.y, 6);
    expect(b.cell.x).toBeGreaterThan(a.cell.x);
    expect(c.cell.y).toBeGreaterThan(a.cell.y);
    expect(c.cell.x).toBeCloseTo(a.cell.x, 6);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: cells stay within margins and never overlap', (_id, preset) => {
    const g = computeGrid(preset, FRAGMENT);
    const [page] = layoutPages(g.perPage, preset, FRAGMENT);
    expect(page.width).toBeCloseTo(mmToPt(preset.page.width), 6);
    expect(page.height).toBeCloseTo(mmToPt(preset.page.height), 6);
    const m = mmToPt(preset.margins);
    for (const c of page.cells) {
      expect(c.fragment.width).toBeCloseTo(FRAGMENT.width * preset.fragmentScale, 6);
      expect(c.fragment.height).toBeCloseTo(FRAGMENT.height * preset.fragmentScale, 6);
      expect(overlaps(c.text, c.fragment)).toBe(false);
      for (const r of [c.text, c.fragment]) {
        expect(r.x).toBeGreaterThanOrEqual(m - 1e-6);
        expect(r.y).toBeGreaterThanOrEqual(m - 1e-6);
        expect(r.x + r.width).toBeLessThanOrEqual(page.width - m + 1e-6);
        expect(r.y + r.height).toBeLessThanOrEqual(page.height - m + 1e-6);
      }
    }
    for (let i = 0; i < page.cells.length; i++) {
      for (let j = i + 1; j < page.cells.length; j++) {
        expect(overlaps(page.cells[i].cell, page.cells[j].cell)).toBe(false);
      }
    }
  });
});
