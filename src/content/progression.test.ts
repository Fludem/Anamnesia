import { describe, expect, it } from 'vitest';
import { combatClimb, hoursToCap, regenPerHour } from '../sim/progression.ts';
import { content, simContext } from './index.ts';

/**
 * The tuning target as a test. "Skills average about 36 hours of idle time to 99": each
 * trainable skill lands in a band on its standard method, the mean sits near 36, and every
 * quick method is faster but not absurdly so. Numbers here are expected values with the
 * tier's tool and no god; see src/sim/progression.ts for the model and DECISIONS.md for why.
 */
const TRAINABLE = content.skills
  .map((s) => s.id)
  .filter((id) => id !== 'combat' && id !== 'hitpoints');

describe('progression: hours to 99', () => {
  const hours = Object.fromEntries(TRAINABLE.map((s) => [s, hoursToCap(s, simContext).hours]));

  it.each(TRAINABLE)('%s reaches 99 in 27–45 hours on its standard method', (skill) => {
    expect(hours[skill]).toBeGreaterThan(27);
    expect(hours[skill]).toBeLessThan(45);
  });

  it('averages about 36 hours across skills', () => {
    const all = [...TRAINABLE.map((s) => hours[s]!), combatClimb(simContext).hours];
    const mean = all.reduce((n, h) => n + h, 0) / all.length;
    expect(mean).toBeGreaterThan(33);
    expect(mean).toBeLessThan(39);
  });

  it('no skill has a gap where nothing is trainable', () => {
    for (const s of TRAINABLE) expect(Number.isFinite(hours[s])).toBe(true);
  });

  it('the early climb is quick: level 10 inside ten minutes, 50 inside two hours', () => {
    for (const s of TRAINABLE) {
      const { milestones } = hoursToCap(s, simContext);
      expect(milestones[10]).toBeLessThan(10 / 60);
      expect(milestones[50]).toBeLessThan(2);
    }
  });

  it.each(['mining', 'woodcutting', 'fishing', 'foraging'])(
    '%s: quick methods cut the climb by 5–20%, and each beats its tier on xp/hr',
    (skill) => {
      const standard = hoursToCap(skill, simContext).hours;
      const quick = hoursToCap(skill, simContext, { quick: true }).hours;
      expect(quick).toBeLessThan(standard * 0.95);
      expect(quick).toBeGreaterThan(standard * 0.8);
      expect(content.nodesFor(skill).filter((n) => n.quick).length).toBeGreaterThanOrEqual(3);
    },
  );
});

/**
 * Combat is measured in ladder gear (src/sim/progression.ts GEAR_LADDER) on the best monster
 * open at each level, xp paid per point of damage. The shape the content must keep: the
 * climb lands in the band, each zone's hardest monster is worth fighting once the zone opens
 * (no level where a one-swing goat is the best xp), and nothing one-shots the hero from half
 * health, so an eat threshold of 50% always holds if the bank has food.
 */
describe('progression: combat', () => {
  const climb = combatClimb(simContext);

  it('reaches 99 in 27–45 hours in ladder gear', () => {
    expect(climb.hours).toBeGreaterThan(27);
    expect(climb.hours).toBeLessThan(45);
    expect(climb.milestones[10]).toBeLessThan(10 / 60);
    expect(climb.milestones[50]).toBeLessThan(2);
  });

  it('the best monster is never more than one zone behind', () => {
    for (const step of climb.steps) {
      const zone = content.zone(content.monster(step.monster).zone);
      const open = content.zones.filter((z) => z.level <= step.level);
      const newest = open[open.length - 1]!;
      const previous = open[open.length - 2] ?? newest;
      expect([newest.id, previous.id], `level ${String(step.level)}`).toContain(zone.id);
    }
  });

  it('no chosen monster can take more than half the hero’s hitpoints in one hit', () => {
    for (const step of climb.steps) expect(step.maxHitFraction).toBeLessThan(0.5);
  });

  it('kills take seconds, not minutes', () => {
    for (const step of climb.steps) {
      expect(step.killSeconds).toBeGreaterThan(3);
      expect(step.killSeconds).toBeLessThan(90);
    }
  });

  /**
   * The gods' boons, measured with favour never running out: an xp boon takes 5–20% off the
   * climb, a food boon takes 20–45% off what is eaten, and none does both in full. Numbers
   * in scripts/tune-boons.ts.
   */
  it('every boon is worth about the same: hours off the climb, or food off the bill', () => {
    const food = (c: typeof climb) => {
      let hp = 0;
      for (const s of c.steps) {
        const need = simContext.xp.xpForLevel(s.level + 1) - simContext.xp.xpForLevel(s.level);
        hp += s.damagePerHour * (need / s.rate);
      }
      return hp;
    };
    const bare = food(climb);
    for (const g of content.gods) {
      const boon = g.perks.combat!;
      const with_ = combatClimb(simContext, { boon });
      const hours = (with_.hours - climb.hours) / climb.hours;
      const eaten = (food(with_) - bare) / bare;
      if (boon.kind === 'attack' || boon.kind === 'strength') {
        expect(hours, g.id).toBeLessThan(-0.05);
        expect(hours, g.id).toBeGreaterThan(-0.2);
      } else {
        expect(hours, g.id).toBe(0);
        expect(eaten, g.id).toBeLessThan(-0.2);
        expect(eaten, g.id).toBeGreaterThan(-0.45);
      }
      if (boon.kind === 'regen') expect(regenPerHour(boon)).toBeGreaterThan(0);
    }
  });

  it('an hour of foraging at any standard patch buys two to three hours of favour', () => {
    for (const p of content.patches.filter((p) => !p.quick)) {
      const item = content.item(p.drops[0]!.entries[0]!.item);
      const favour =
        ((36_000 / p.durationTicks) * p.success.base * (item.stats.favour ?? 0)) / 3600;
      expect(favour, p.id).toBeGreaterThan(2);
      expect(favour, p.id).toBeLessThan(3);
    }
  });
});
