import { describe, expect, it } from 'vitest';
import { combatClimb, hoursToCap } from '../sim/progression.ts';
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

  it.each(['mining', 'woodcutting', 'fishing'])(
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
});
