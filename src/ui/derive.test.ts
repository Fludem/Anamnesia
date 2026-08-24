import { describe, expect, it } from 'vitest';
import { beginAction } from '../sim/actions.ts';
import { addItem } from '../sim/items.ts';
import { addXp } from '../sim/progress.ts';
import { createSimState, type SimState } from '../sim/save.ts';
import { stepTick } from '../sim/step.ts';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import {
  actionScreen,
  activeView,
  dropFeed,
  gainTicker,
  nodeViews,
  recap,
  recentLevelUp,
  recentRareDrop,
  recipeViews,
  skillView,
  xpPerHour,
} from './derive.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};
const mine = (rock: string) => ({ kind: 'mining', rock, count: null }) as const;

describe('skillView', () => {
  it('reports level, xp into the level and its size', () => {
    const s = addXp(createSimState(1), 'mining', 100);
    // Level 2 at 83, level 3 at 174.
    expect(skillView(s, 'mining', ctx)).toMatchObject({
      level: 2,
      xp: 100,
      floor: 83,
      next: 174,
      into: 17,
      need: 91,
    });
    expect(skillView(s, 'mining', ctx).frac).toBeCloseTo(17 / 91);
    expect(skillView(s, 'woodcutting', ctx)).toMatchObject({ level: 1, into: 0, need: 83 });
  });

  it('is complete at the cap', () => {
    const s = addXp(createSimState(1), 'mining', 200_000_000);
    expect(skillView(s, 'mining', ctx)).toMatchObject({
      level: 99,
      next: null,
      need: null,
      frac: 1,
    });
  });
});

describe('rates', () => {
  it('xp/hr follows the cycle length and success chance', () => {
    expect(xpPerHour(68, 27)).toBeCloseTo(90_666.67, 1);
    expect(xpPerHour(10, 36_000, 0.5)).toBe(5);
  });
});

describe('nodeViews', () => {
  it('locks nodes above the level, marks the active one, and applies the tool', () => {
    const base: SimState = {
      ...createSimState(1),
      equipment: { ...createSimState(1).equipment, pickaxe: 'pick' },
    };
    const s = beginAction(base, mine('sure-rock'), ctx);
    const views = nodeViews(
      s,
      ctx.content.rocks,
      { skill: 'mining', toolSlot: 'pickaxe', request: mine },
      ctx,
    );
    expect(views.map((v) => [v.node.id, v.locked, v.active, v.ticks])).toEqual([
      ['sure-rock', false, true, 2],
      ['flaky-rock', false, false, 2],
      ['gated-rock', true, false, 3],
    ]);
    expect(views[2]?.chance).toBe(0);
    expect(views[2]?.xpHr).toBe(0);
    expect(views[0]?.xpHr).toBe(xpPerHour(10, 2));
  });
});

describe('recipeViews', () => {
  it('knows affordability and how many runs the bank holds', () => {
    const s = { ...createSimState(1), bank: addItem([], 'ore', 5) };
    const [bar, gated] = recipeViews(s, ctx.content.recipes, ctx);
    expect(bar).toMatchObject({ locked: false, canAfford: true, times: 2 });
    expect(gated).toMatchObject({ locked: true, canAfford: true, times: 5 });
    expect(recipeViews(createSimState(1), ctx.content.recipes, ctx)[0]).toMatchObject({
      canAfford: false,
      times: 0,
    });
  });
});

describe('activeView', () => {
  it('describes the cycle in progress', () => {
    let s = beginAction(createSimState(1), mine('sure-rock'), ctx);
    expect(activeView(s, ctx)).toMatchObject({
      skill: 'mining',
      name: 'Sure rock',
      frac: 0,
      remainingMs: 300,
      durationMs: 300,
      xp: 10,
      remaining: null,
    });
    s = run(s, 2);
    expect(activeView(s, ctx)?.frac).toBeCloseTo(2 / 3);
    expect(activeView(s, ctx)?.remainingMs).toBe(100);
    expect(activeView(createSimState(1), ctx)).toBeNull();
  });
});

describe('feed and moments', () => {
  it('lists drops newest first with their age in ticks', () => {
    let s = beginAction(createSimState(1), mine('sure-rock'), ctx);
    s = run(s, 7);
    const feed = dropFeed(s, ctx.content);
    expect(feed.map((r) => [r.item.id, r.qty, r.ageTicks])).toEqual([
      ['stone', 1, 1],
      ['stone', 1, 4],
    ]);
    expect(dropFeed(s, ctx.content, { skill: 'woodcutting' })).toEqual([]);
    expect(dropFeed(s, ctx.content, { limit: 1 }).length).toBe(1);
    expect(feed.every((r) => !r.found)).toBe(true);
    // A find rides the same feed, marked.
    const found: SimState = {
      ...s,
      log: [
        ...s.log,
        { type: 'found', tick: s.tick, skill: 'mining', items: [{ item: 'cape', qty: 1 }] },
      ],
    };
    expect(dropFeed(found, ctx.content)[0]).toMatchObject({ found: true, ageTicks: 0 });
    expect(dropFeed(found, ctx.content)[0]?.item.id).toBe('cape');
  });

  it('surfaces a level-up only while it is fresh', () => {
    let s = beginAction(createSimState(1), mine('sure-rock'), ctx);
    s = run(s, 27); // level 2 at tick 27
    expect(recentLevelUp(s, 40)).toMatchObject({ skill: 'mining', to: 2 });
    const idle = { ...s, action: { current: null, queue: [] } };
    expect(recentLevelUp(run(idle, 39), 40)).not.toBeNull();
    expect(recentLevelUp(run(idle, 40), 40)).toBeNull();
  });

  it('finds a fresh rare drop by rarity rank', () => {
    let s = beginAction(createSimState(1), mine('sure-rock'), ctx);
    s = run(s, 3);
    // Fixture items are all common (rank 0), so rank ≥ 1 finds nothing and rank 0 finds stone.
    expect(recentRareDrop(s, ctx.content, { minRank: 1, withinTicks: 26 })).toBeNull();
    expect(recentRareDrop(s, ctx.content, { minRank: 0, withinTicks: 26 })?.item.id).toBe('stone');
    expect(recentRareDrop(s, ctx.content, { minRank: 0, withinTicks: 0 })).toBeNull();
  });
});

describe('recap', () => {
  it('diffs xp, levels, actions and bank gains between two states', () => {
    const before = { ...createSimState(1), bank: addItem([], 'stone', 2) };
    let after = beginAction(before, mine('sure-rock'), ctx);
    after = run(after, 30); // 10 cycles: +100 xp, level 2, +10 stone
    const r = recap(before, after, ctx);
    expect(r.skills).toEqual([{ skill: 'mining', xp: 100, from: 1, to: 2, actions: 10 }]);
    expect(r.items).toEqual([{ item: 'stone', qty: 10 }]);
    expect(r.totalActions).toBe(10);
    expect(recap(before, before, ctx)).toEqual({
      skills: [],
      items: [],
      records: [],
      totalActions: 0,
    });
  });
});

describe('actionScreen', () => {
  it('sends gathering home, a recipe to its bench and every fight to the combat screen', () => {
    expect(actionScreen(mine('sure-rock'), ctx)).toBe('mining');
    expect(actionScreen({ kind: 'crafting', recipe: 'bar', count: null }, ctx)).toBe('smithing');
    expect(actionScreen({ kind: 'combat', monster: 'goat', count: null }, ctx)).toBe('combat');
  });
});

describe('gainTicker', () => {
  it('counts what just landed against the bank, merging cycles into one moving pill', () => {
    const seeded = { ...createSimState(1), bank: addItem([], 'stone', 563) };
    let s = beginAction(seeded, mine('sure-rock'), ctx);
    s = run(s, 3); // one cycle: +1 stone
    const first = gainTicker(s, ctx.content, 45);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ gained: 1, total: 564 });
    expect(first[0]!.item.id).toBe('stone');
    s = run(s, 6); // two more cycles merge in, and the key moves with the newest tick
    const merged = gainTicker(s, ctx.content, 45);
    expect(merged[0]).toMatchObject({ gained: 3, total: 566 });
    expect(merged[0]!.key).not.toBe(first[0]!.key);
  });

  it('forgets gains older than the window', () => {
    let s = beginAction(createSimState(1), mine('sure-rock'), ctx);
    s = run(s, 3);
    s = { ...s, action: { current: null, queue: [] } };
    s = run(s, 45);
    expect(gainTicker(s, ctx.content, 45)).toEqual([]);
  });
});
