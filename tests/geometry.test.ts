import { describe, expect, it } from 'vitest';
import { containsPoint, mmToPt, PT_PER_MM } from '../src/geometry';

describe('geometry', () => {
  it('converts millimetres to points', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(PT_PER_MM).toBeCloseTo(2.834645, 5);
  });

  it('containsPoint includes edges and excludes outside points', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(containsPoint(r, 10, 20)).toBe(true);
    expect(containsPoint(r, 40, 60)).toBe(true);
    expect(containsPoint(r, 25, 30)).toBe(true);
    expect(containsPoint(r, 9.9, 30)).toBe(false);
    expect(containsPoint(r, 25, 60.1)).toBe(false);
  });
});
