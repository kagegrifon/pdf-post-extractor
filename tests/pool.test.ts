import { describe, expect, it } from 'vitest';
import { mapWithLimit } from '../src/pool';

describe('mapWithLimit', () => {
  it('keeps result order and never runs more than `limit` tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
  });
});
