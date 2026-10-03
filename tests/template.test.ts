import { describe, expect, it } from 'vitest';
import { containsPoint } from '../src/geometry';
import {
  CROP_GAP,
  findTemplate,
  getTemplate,
  RUSSIAN_POST_ENVELOPE,
  RUSSIAN_POST_F7B,
  stackCrops,
  TEMPLATES,
} from '../src/template';

describe('template', () => {
  it('finds the envelope template by page size with 1pt tolerance', () => {
    expect(findTemplate(623.6, 311.8)).toBe(RUSSIAN_POST_ENVELOPE);
    expect(findTemplate(624.4, 311.0)).toBe(RUSSIAN_POST_ENVELOPE);
    expect(findTemplate(595.28, 841.89)).toBeUndefined();
  });

  it('getTemplate returns by id and throws for unknown id', () => {
    expect(getTemplate('russian-post-envelope-v1')).toBe(RUSSIAN_POST_ENVELOPE);
    expect(() => getTemplate('nope')).toThrow();
  });

  it('finds the f7b template by A5 page size', () => {
    expect(findTemplate(419.53, 595.28)).toBe(RUSSIAN_POST_F7B);
  });

  it('crops lie inside the page and the numbered crop exists', () => {
    for (const t of TEMPLATES) {
      expect(t.crops[t.numberedCrop]).toBeDefined();
      for (const crop of t.crops) {
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.width).toBeLessThanOrEqual(t.pageSize.width);
        expect(crop.y + crop.height).toBeLessThanOrEqual(t.pageSize.height);
      }
    }
  });

  it('stackCrops: a single crop is the fragment itself', () => {
    const stack = stackCrops(RUSSIAN_POST_ENVELOPE);
    expect(stack).toEqual({ width: 218, height: 158, pieces: [{ crop: RUSSIAN_POST_ENVELOPE.crops[0], x: 0, y: 0 }] });
  });

  it('stackCrops: f7b crops go top to bottom, right-aligned, with a gap for the cut', () => {
    const [mark, barcode] = RUSSIAN_POST_F7B.crops;
    const stack = stackCrops(RUSSIAN_POST_F7B);
    expect(stack.width).toBe(mark.width);
    expect(stack.height).toBe(mark.height + CROP_GAP + barcode.height);
    expect(stack.pieces).toEqual([
      { crop: mark, x: 0, y: 0 },
      { crop: barcode, x: mark.width - barcode.width, y: mark.height + CROP_GAP },
    ]);
  });

  it('f7b zones contain the baselines observed in the real sample', () => {
    const z = RUSSIAN_POST_F7B.zones;
    expect(containsPoint(z.senderName, 45, 132.4)).toBe(true);
    expect(containsPoint(z.senderAddress, 45, 151.4)).toBe(true);
    expect(containsPoint(z.senderIndex, 141.4, 208)).toBe(true);
    expect(containsPoint(z.recipientName, 241, 132.4)).toBe(true);
    expect(containsPoint(z.recipientAddress, 241, 151.4)).toBe(true);
    expect(containsPoint(z.recipientIndex, 346.4, 208)).toBe(true);
    for (const [x, y] of [[15.6, 282.4], [65, 282.4], [95, 282.4], [140, 282.4]]) {
      expect(containsPoint(z.track, x, y)).toBe(true);
    }
  });

  it('zones contain the baselines observed in real samples', () => {
    const z = RUSSIAN_POST_ENVELOPE.zones;
    expect(containsPoint(z.senderName, 53, 21.8)).toBe(true);
    expect(containsPoint(z.senderAddress, 53, 60.8)).toBe(true);
    expect(containsPoint(z.senderIndex, 190, 114.8)).toBe(true);
    expect(containsPoint(z.track, 433.6, 160.5)).toBe(true);
    expect(containsPoint(z.recipientName, 367, 177.3)).toBe(true);
    expect(containsPoint(z.recipientAddress, 367, 215.8)).toBe(true);
    expect(containsPoint(z.recipientAddress, 342, 234.5)).toBe(true);
    expect(containsPoint(z.recipientIndex, 383, 289.8)).toBe(true);
  });

  it('no zone contains the PostIndex duplicate at (25, 279.8)', () => {
    for (const zone of Object.values(RUSSIAN_POST_ENVELOPE.zones)) {
      expect(containsPoint(zone, 25, 279.8)).toBe(false);
    }
  });
});
