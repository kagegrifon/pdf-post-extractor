import { describe, expect, it } from 'vitest';
import { containsPoint } from '../src/geometry';
import { findTemplate, getTemplate, RUSSIAN_POST_ENVELOPE, TEMPLATES } from '../src/template';

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

  it('crop lies inside the page', () => {
    for (const t of TEMPLATES) {
      expect(t.crop.x).toBeGreaterThanOrEqual(0);
      expect(t.crop.y).toBeGreaterThanOrEqual(0);
      expect(t.crop.x + t.crop.width).toBeLessThanOrEqual(t.pageSize.width);
      expect(t.crop.y + t.crop.height).toBeLessThanOrEqual(t.pageSize.height);
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
