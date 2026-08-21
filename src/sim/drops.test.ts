import { describe, expect, it } from 'vitest';
import { DropTableSchema, type DropTable } from './content/schema.ts';
import { rollDropTable } from './drops.ts';
import { nextInt, seedRng } from './rng.ts';

const table = (t: unknown): DropTable => DropTableSchema.parse(t);

describe('rollDropTable', () => {
  it('a single guaranteed entry with a fixed quantity makes exactly one draw', () => {
    const t = table({ entries: [{ item: 'ore', weight: 1 }] });
    const rng = seedRng(1);
    const [drops, after] = rollDropTable(t, rng);
    expect(drops).toEqual([{ item: 'ore', qty: 1 }]);
    expect(after).toEqual(nextInt(rng, 0, 0)[1]);
  });

  it('quantity ranges cost one extra draw, taken after the entry pick', () => {
    const t = table({ entries: [{ item: 'ore', weight: 1, quantity: [1, 3] }] });
    const rng = seedRng(1);
    const [, afterPick] = nextInt(rng, 0, 0);
    const [qty, afterQty] = nextInt(afterPick, 1, 3);
    const [drops, after] = rollDropTable(t, rng);
    expect(drops).toEqual([{ item: 'ore', qty }]);
    expect(after).toEqual(afterQty);
  });

  it('produces exact results from a fixed seed (pinned)', () => {
    const t = table({
      rolls: 6,
      nothingWeight: 2,
      entries: [
        { item: 'gem', weight: 1, quantity: [1, 2] },
        { item: 'rare', weight: 1 },
      ],
    });
    const [drops] = rollDropTable(t, seedRng(42));
    expect(drops).toEqual([
      { item: 'rare', qty: 1 },
      { item: 'rare', qty: 1 },
      { item: 'gem', qty: 2 },
    ]);
  });

  it('weights and nothingWeight produce the expected frequencies over many rolls', () => {
    const t = table({
      nothingWeight: 50,
      entries: [
        { item: 'common', weight: 40 },
        { item: 'rare', weight: 10 },
      ],
    });
    const counts = { common: 0, rare: 0, nothing: 0 };
    let rng = seedRng(7);
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      let drops;
      [drops, rng] = rollDropTable(t, rng);
      if (drops.length === 0) counts.nothing++;
      else counts[drops[0]!.item as 'common' | 'rare']++;
    }
    expect(counts.nothing / N).toBeCloseTo(0.5, 2);
    expect(counts.common / N).toBeCloseTo(0.4, 2);
    expect(counts.rare / N).toBeCloseTo(0.1, 2);
  });

  it('handles fractional weights', () => {
    const t = table({
      nothingWeight: 0.5,
      entries: [{ item: 'x', weight: 0.5 }],
    });
    let hits = 0;
    let rng = seedRng(3);
    for (let i = 0; i < 20_000; i++) {
      let drops;
      [drops, rng] = rollDropTable(t, rng);
      if (drops.length) hits++;
    }
    expect(hits / 20_000).toBeCloseTo(0.5, 1);
  });
});
