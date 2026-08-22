import { describe, expect, it } from 'vitest';
import {
  board,
  heroWealth,
  hoursElapsed,
  rivalWealth,
  rivalXp,
  standings,
  xpAfterHours,
} from './highscores.ts';
import { addItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const TICKS_PER_HOUR = 36_000;
const oldHand = ctx.content.rivals[0]!;
const idler = ctx.content.rivals[1]!;

const hero = (patch: Partial<SimState> = {}): SimState => ({
  ...createSimState(1),
  player: { name: 'Tester', god: null },
  ...patch,
});

describe('xp after hours on the climb', () => {
  it('takes the best method open at every level, with the tier’s tool', () => {
    expect(xpAfterHours('mining', 0, ctx)).toBe(0);
    // Level 1 is the sure rock: 10 xp / 3 ticks = 120,000 xp/h. From level 2 the flaky rock
    // out-earns it as its success climbs, and the gated rock opens at 10 (pinned figures).
    expect(xpAfterHours('mining', 0.0005, ctx)).toBeCloseTo(60, 6);
    expect(xpAfterHours('mining', 0.005, ctx)).toBeCloseTo(730.376, 2);
    expect(xpAfterHours('mining', 0.01, ctx)).toBeCloseTo(3181.255, 2);
  });

  it('never stops: past 99 the top rate keeps paying', () => {
    const cap = ctx.xp.xpForLevel(99);
    const at = xpAfterHours('mining', 100, ctx);
    expect(at).toBeGreaterThan(cap);
    expect(xpAfterHours('mining', 101, ctx) - at).toBeGreaterThan(0);
    expect(ctx.xp.levelForXp(at)).toBe(99);
  });

  it('is monotone in hours and zero for a skill nothing trains', () => {
    let last = 0;
    for (const h of [0.001, 0.01, 0.1, 1, 10]) {
      const xp = xpAfterHours('mining', h, ctx);
      expect(xp).toBeGreaterThan(last);
      last = xp;
    }
    expect(xpAfterHours('hitpoints', 5, ctx)).toBe(0);
  });
});

describe('rivals', () => {
  it('move with the hero’s game time at their pace, and hitpoints follows combat', () => {
    expect(rivalXp(oldHand, 'mining', 0, ctx)).toBe(xpAfterHours('mining', 1, ctx));
    expect(rivalXp(oldHand, 'mining', 3, ctx)).toBe(xpAfterHours('mining', 2, ctx));
    expect(rivalXp(oldHand, 'woodcutting', 3, ctx)).toBe(0);
    expect(rivalXp(oldHand, 'hitpoints', 0, ctx)).toBe(rivalXp(oldHand, 'combat', 0, ctx) / 3);
    expect(rivalXp(idler, 'mining', 100, ctx)).toBe(0);
  });

  it('earn a line of coins', () => {
    expect(rivalWealth(oldHand, 0)).toBe(100);
    expect(rivalWealth(oldHand, 2.55)).toBe(125);
    expect(rivalWealth(idler, 1000)).toBe(1000);
  });

  it('read the clock from the tick', () => {
    expect(hoursElapsed(hero({ tick: TICKS_PER_HOUR }))).toBe(1);
    expect(hoursElapsed(hero({ tick: 18_000 }))).toBe(0.5);
  });
});

describe('wealth', () => {
  it('is coins plus the bank at sale value plus everything worn', () => {
    let s = hero({ coins: 5 });
    s = {
      ...s,
      bank: addItem(s.bank, 'stone', 10),
      equipment: { ...s.equipment, pickaxe: 'pick' },
    };
    expect(heroWealth(s, ctx.content)).toBe(5 + 10 + 20);
  });
});

describe('boards', () => {
  it('rank by xp, ties going to whoever was here first', () => {
    const rows = board(hero(), 'mining', ctx);
    expect(rows.map((r) => [r.rank, r.rival, r.level])).toEqual([
      [1, 'old-hand', ctx.xp.levelForXp(xpAfterHours('mining', 1, ctx))],
      [2, 'idler', 1],
      [3, null, 1],
    ]);
    expect(rows[2]).toMatchObject({ name: 'Tester', god: null, line: null, score: 0 });
    expect(rows[0]).toMatchObject({ name: 'Old hand', god: 'stone-god', line: 'Was here first.' });
    // Equal xp: the rival keeps the higher rank.
    const tied = hero({ skills: { mining: { xp: xpAfterHours('mining', 1, ctx) } } });
    expect(board(tied, 'mining', ctx).map((r) => r.rival)).toEqual(['old-hand', null, 'idler']);
    const ahead = hero({ skills: { mining: { xp: xpAfterHours('mining', 1, ctx) + 1 } } });
    expect(board(ahead, 'mining', ctx)[0]).toMatchObject({ rank: 1, rival: null });
  });

  it('wealth ranks coins and carries no level', () => {
    const rows = board(hero({ coins: 150 }), 'wealth', ctx);
    expect(rows.map((r) => [r.rival, r.score, r.level])).toEqual([
      ['idler', 1000, null],
      [null, 150, null],
      ['old-hand', 100, null],
    ]);
  });

  it('total level sums every skill, hitpoints included, with total xp breaking ties', () => {
    const skills = ctx.content.skills.length;
    const rows = board(hero(), 'total', ctx);
    const oldHandLevels =
      ctx.xp.levelForXp(xpAfterHours('mining', 1, ctx)) +
      ctx.xp.levelForXp(rivalXp(oldHand, 'combat', 0, ctx)) +
      ctx.xp.levelForXp(rivalXp(oldHand, 'hitpoints', 0, ctx)) +
      (skills - 3);
    expect(rows.map((r) => [r.rival, r.level])).toEqual([
      ['old-hand', oldHandLevels],
      ['idler', skills],
      [null, skills],
    ]);
    // One xp in anything puts the hero above the idler at the same total level.
    const nudged = hero({ skills: { fishing: { xp: 1 } } });
    expect(board(nudged, 'total', ctx).map((r) => r.rival)).toEqual(['old-hand', null, 'idler']);
  });

  it('the hero’s standings cover total, wealth and every skill in content order', () => {
    const s = standings(hero({ coins: 150 }), ctx);
    expect(s.map((x) => x.board)).toEqual([
      'total',
      'wealth',
      ...ctx.content.skills.map((x) => x.id),
    ]);
    expect(s.every((x) => x.of === 3)).toBe(true);
    expect(s[1]).toMatchObject({ board: 'wealth', rank: 2, level: null, score: 150 });
    expect(s[2]).toMatchObject({ board: 'mining', rank: 3, level: 1, score: 0 });
  });
});
