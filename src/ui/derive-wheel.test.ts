import { describe, expect, it } from 'vitest';
import type { WheelGet } from '../api/protocol.ts';
import { GRID_ROWS, chipText, myStake, phaseAt, spinLine, stacks, strip } from './derive-wheel.ts';

const data = (over: Partial<WheelGet> = {}): WheelGet => ({
  now: 1_000_000,
  round: { id: 33, opensAt: 990_000, closesAt: 1_014_000, endsAt: 1_020_000, pocket: null },
  purse: { coins: 500, staked: 0, returned: 0 },
  table: [
    {
      name: 'Ann',
      bets: [
        { spot: 'red', stake: 150 },
        { spot: 'straight:17', stake: 10 },
      ],
    },
    { name: 'Bea', bets: [{ spot: 'red', stake: 500 }] },
  ],
  last: [
    {
      id: 32,
      pocket: 17,
      players: [
        { name: 'Ann', staked: 140, returned: 450 },
        { name: 'Bea', staked: 250, returned: 0 },
        { name: 'Cid', staked: 10, returned: 10 },
      ],
    },
    { id: 31, pocket: 37, players: [] },
    { id: 30, pocket: 0, players: [] },
  ],
  ...over,
});

describe('the round', () => {
  it('is open until the close, turning until the pocket is known, then shown', () => {
    expect(phaseAt(data(), 1_000_000)).toEqual({ kind: 'open', leftMs: 14_000 });
    expect(phaseAt(data(), 1_014_000)).toEqual({ kind: 'turning', leftMs: 6_000 });
    const drawn = data({ round: { ...data().round, pocket: 5 } });
    expect(phaseAt(drawn, 1_015_000)).toEqual({ kind: 'shown', leftMs: 5_000, pocket: 5 });
    expect(phaseAt(drawn, 1_030_000)).toEqual({ kind: 'shown', leftMs: 0, pocket: 5 });
  });
});

describe('the table', () => {
  it('stacks every name on a spot and knows which chips are mine', () => {
    const s = stacks(data(), 'Ann');
    expect(s.get('red')).toEqual({ mine: 150, all: 650 });
    expect(s.get('straight:17')).toEqual({ mine: 10, all: 10 });
    expect(s.get('black')).toBeUndefined();
    expect(myStake(data(), 'Ann')).toBe(160);
    expect(myStake(data(), 'Bea')).toBe(500);
    expect(myStake(data(), 'Nobody')).toBe(0);
  });

  it('lays the numbers out three rows of twelve, the third column on top', () => {
    expect(GRID_ROWS[0]?.slice(0, 3)).toEqual([3, 6, 9]);
    expect(GRID_ROWS[2]?.slice(0, 3)).toEqual([1, 4, 7]);
    expect(GRID_ROWS.flat().sort((a, b) => a - b)).toEqual(
      Array.from({ length: 36 }, (_, i) => i + 1),
    );
  });

  it('names a stack shortly', () => {
    expect(chipText(100)).toBe('100');
    expect(chipText(1500)).toBe('1.5k');
    expect(chipText(20_000)).toBe('20k');
    expect(chipText(2_000_000)).toBe('2M');
  });
});

describe('the strip and the line', () => {
  it('colours the last pockets, newest first', () => {
    expect(strip(data()).map((p) => `${p.label}:${p.colour}`)).toEqual([
      '17:black',
      '00:house',
      '0:house',
    ]);
  });

  it('says what the last spin did to each name', () => {
    expect(spinLine(data().last[0]!)).toBe(
      '17 black · Ann took 450 for 140 · Bea lost 250 · Cid broke even',
    );
    expect(spinLine(data().last[1]!)).toBe('00 the house · nobody had a bet down');
  });
});
