import { describe, expect, it } from 'vitest';
import { addItem, addStacks, countItem, removeItem, type Container } from './items.ts';

describe('containers', () => {
  it('addItem merges into an existing stack and appends new ones, without mutating', () => {
    const a: Container = [{ item: 'ore', qty: 2 }];
    const b = addItem(a, 'ore', 3);
    const c = addItem(b, 'gem', 1);
    expect(a).toEqual([{ item: 'ore', qty: 2 }]);
    expect(b).toEqual([{ item: 'ore', qty: 5 }]);
    expect(c).toEqual([
      { item: 'ore', qty: 5 },
      { item: 'gem', qty: 1 },
    ]);
    expect(countItem(c, 'ore')).toBe(5);
    expect(countItem(c, 'nothing')).toBe(0);
  });

  it('removeItem drops empty stacks and refuses to overdraw', () => {
    const c: Container = [
      { item: 'ore', qty: 5 },
      { item: 'gem', qty: 1 },
    ];
    expect(removeItem(c, 'ore', 2)).toEqual([
      { item: 'ore', qty: 3 },
      { item: 'gem', qty: 1 },
    ]);
    expect(removeItem(c, 'gem', 1)).toEqual([{ item: 'ore', qty: 5 }]);
    expect(removeItem(c, 'gem', 2)).toBeNull();
    expect(removeItem(c, 'coal', 1)).toBeNull();
  });

  it('rejects non-positive quantities', () => {
    expect(() => addItem([], 'ore', 0)).toThrow(RangeError);
    expect(() => addItem([], 'ore', 1.5)).toThrow(RangeError);
    expect(() => removeItem([], 'ore', -1)).toThrow(RangeError);
  });

  it('addStacks applies in order', () => {
    expect(
      addStacks(
        [],
        [
          { item: 'a', qty: 1 },
          { item: 'b', qty: 2 },
          { item: 'a', qty: 1 },
        ],
      ),
    ).toEqual([
      { item: 'a', qty: 2 },
      { item: 'b', qty: 2 },
    ]);
  });
});
