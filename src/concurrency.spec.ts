import { describe, expect, it } from 'vitest';

import { mapLimit } from './concurrency.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('mapLimit', () => {
  it('keeps the input order', async () => {
    const result = await mapLimit([30, 10, 20], 2, async (ms) => {
      await delay(ms);
      return ms * 2;
    });
    expect(result).toEqual([60, 20, 40]);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(5);
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it('returns an empty array for no items', async () => {
    expect(await mapLimit([], 4, () => Promise.resolve(1))).toEqual([]);
  });
});
