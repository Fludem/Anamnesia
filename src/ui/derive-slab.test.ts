import { describe, expect, it } from 'vitest';
import { createSimState, type SimState } from '../sim/save.ts';
import { fixtureContent as content, fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { content as shipped, simContext } from '../content/index.ts';
import { slabView } from './derive-slab.ts';

const atLevel = (level: number, records = {}): SimState => ({
  ...createSimState(1),
  skills: { fishing: { xp: ctx.xp.xpForLevel(level) } },
  records: { fish: {}, trophies: [], ...records },
});

describe('the slab', () => {
  it('has a row for every water that gives something weighed, and none for one that does not', () => {
    const view = slabView(atLevel(1), content, ctx);
    expect(view.rows.map((r) => r.water.id)).toEqual(['deep-water']);
    expect(view.kinds).toBe(1);
    expect(view.weighed).toBe(0);
    expect(view.won).toBe(0);
    expect(view.owed).toBe(500);
  });

  it('reads a line off the save and places it in the whole band, not what is in reach', () => {
    const view = slabView(
      atLevel(1, { fish: { 'big-fish': { grams: 600, tick: 40 } } }),
      content,
      ctx,
    );
    const row = view.rows[0]!;
    expect(row.best).toBe(600);
    expect(row.tick).toBe(40);
    expect(row.into).toBeCloseTo(0.5);
    expect(row.trophyInto).toBeCloseTo(0.95);
    expect(view.weighed).toBe(1);
  });

  it('says the line is out of reach until the level it opens at, and not after', () => {
    expect(slabView(atLevel(1), content, ctx).rows[0]?.outOfReach).toBe(true);
    expect(slabView(atLevel(27), content, ctx).rows[0]?.outOfReach).toBe(true);
    expect(slabView(atLevel(31), content, ctx).rows[0]?.outOfReach).toBe(false);
    expect(slabView(atLevel(1), content, ctx).rows[0]?.opensAt).toBe(28);
  });

  it('shows what is reachable now, which grows with the level', () => {
    expect(slabView(atLevel(1), content, ctx).rows[0]?.ceiling).toBe(600);
    expect(slabView(atLevel(99), content, ctx).rows[0]?.ceiling).toBe(1100);
  });

  it('counts a paid trophy and takes its coins off the table', () => {
    const view = slabView(
      atLevel(99, { fish: { 'big-fish': { grams: 1080, tick: 9 } }, trophies: ['big-fish'] }),
      content,
      ctx,
    );
    expect(view.rows[0]?.won).toBe(true);
    expect(view.won).toBe(1);
    expect(view.owed).toBe(0);
  });

  it('locks the rows whose waters the hero cannot fish yet, over the shipped hill', () => {
    const novice = slabView(atLevel(1), shipped, simContext);
    expect(novice.rows.length).toBe(11);
    expect(novice.rows[0]?.locked).toBe(false); // the Rain Pool takes anyone
    expect(novice.rows.filter((r) => r.locked).length).toBe(10);
    const master = slabView(atLevel(99), shipped, simContext);
    expect(master.rows.filter((r) => r.locked).length).toBe(0);
    // At 99 every band is open to the top, so every trophy is finally within reach.
    expect(master.rows.filter((r) => r.outOfReach).length).toBe(0);
  });

  it('is dead ground before the climb: at level 1 not one line on the hill can be crossed', () => {
    const novice = slabView(atLevel(1), shipped, simContext);
    expect(novice.rows.every((r) => r.outOfReach)).toBe(true);
    expect(novice.rows.map((r) => r.opensAt)).toEqual([28, 37, 42, 49, 62, 72, 77, 92, 97, 98, 99]);
  });
});
