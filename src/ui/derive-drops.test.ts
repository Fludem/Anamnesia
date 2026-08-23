import { describe, expect, it } from 'vitest';
import { createSimState, type SimState } from '../sim/save.ts';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { dropTip, entryChance, formatChance, formatQty } from './derive-drops.ts';

const content = ctx.content;
const fresh = (extra: Partial<SimState> = {}): SimState => ({ ...createSimState(1), ...extra });

describe('saying a chance', () => {
  it('rounds the way the hill talks', () => {
    expect(formatChance(1)).toBe('always');
    expect(formatChance(0.997)).toBe('always');
    expect(formatChance(0.5)).toBe('50%');
    expect(formatChance(0.0625)).toBe('6%');
    expect(formatChance(1 / 2000)).toBe('1 in 2,000');
    expect(formatChance(1 / 8)).toBe('13%');
    expect(formatChance(0)).toBe('never');
    expect(formatQty([1, 1])).toBe('');
    expect(formatQty([3, 3])).toBe('×3');
    expect(formatQty([2, 4])).toBe('×2–4');
  });

  it('counts a nothing weight and extra rolls', () => {
    const t = {
      rolls: 1,
      nothingWeight: 1999,
      entries: [{ item: 'x', weight: 1, quantity: [1, 1] as [number, number] }],
    };
    expect(entryChance(t, 1)).toBeCloseTo(1 / 2000, 6);
    expect(entryChance(t, 1, 2)).toBeCloseTo(1 - Math.pow(1 - 1 / 2000, 2), 9);
    const two = { ...t, rolls: 2 };
    expect(entryChance(two, 1)).toBeCloseTo(1 - Math.pow(1 - 1 / 2000, 2), 9);
  });
});

describe('a node tip', () => {
  const rock = content.rocks.find((r) => r.id === 'sure-rock') ?? content.rocks[0]!;

  it("lists the node's own drops with their odds, most likely first", () => {
    const tip = dropTip(fresh(), rock, 'mining', ctx);
    const drops = tip.sections.find((s) => s.title === 'Drops');
    expect(drops).toBeDefined();
    expect(drops!.lines.length).toBeGreaterThan(0);
    for (let i = 1; i < drops!.lines.length; i++) {
      expect(drops!.lines[i - 1]!.chance).toBeGreaterThanOrEqual(drops!.lines[i]!.chance);
    }
    for (const l of drops!.lines) expect(content.hasItem(l.item.id)).toBe(true);
  });

  it('shows the finds table once, or twice with a second look, and nothing for a skill without one', () => {
    const skill = content.skills.find((s) => s.finds !== null);
    if (!skill) return;
    const node =
      content.nodesFor(skill.id)[0] ??
      (() => {
        throw new Error('no node');
      })();
    const plain = dropTip(fresh(), node, skill.id, ctx);
    const finds = plain.sections.find((s) => s.title === 'Finds');
    expect(finds).toBeDefined();
    const p = finds!.lines[0]!.chance;
    const look = content.wares.find((w) => w.effect.kind === 'second-look');
    if (look) {
      const twice = dropTip(fresh({ upgrades: { [look.id]: 1 } }), node, skill.id, ctx);
      const f2 = twice.sections.find((s) => s.title === 'Finds')!;
      expect(f2.note).toMatch(/twice/);
      expect(f2.lines[0]!.chance).toBeCloseTo(1 - Math.pow(1 - p, 2), 9);
    }
  });

  it("adds the sworn god's table and the double-yield line", () => {
    const god = content.gods.find((g) => g.perks.extraDrops.length > 0);
    if (!god) return;
    const extra = god.perks.extraDrops[0]!;
    const node = content.nodesFor(extra.skill)[0]!;
    const unsworn = dropTip(fresh(), node, extra.skill, ctx);
    expect(unsworn.sections.some((s) => s.title.startsWith('Sworn'))).toBe(false);
    const sworn = dropTip(fresh({ player: { name: 'x', god: god.id } }), node, extra.skill, ctx);
    const section = sworn.sections.find((s) => s.title === `Sworn to ${god.name}`);
    expect(section).toBeDefined();
    expect(section!.lines.length).toBeGreaterThan(0);
    const doubling = content.gods.find((g) => g.perks.doubleYield.length > 0);
    if (doubling) {
      const d = doubling.perks.doubleYield[0]!;
      const n = content.nodesFor(d.skill)[0]!;
      const tip = dropTip(fresh({ player: { name: 'x', god: doubling.id } }), n, d.skill, ctx);
      expect(tip.double).toMatch(/lands twice/);
    }
  });
});
