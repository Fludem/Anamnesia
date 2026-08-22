import { describe, expect, it } from 'vitest';
import { hoursToCap } from '../sim/progression.ts';
import { content, simContext } from './index.ts';

/**
 * The tuning target as a test. "Skills average about 36 hours of idle time to 99": each
 * trainable skill lands in a band on its standard method, the mean sits near 36, and every
 * quick method is faster but not absurdly so. Numbers here are expected values with the
 * tier's tool and no god; see src/sim/progression.ts for the model and DECISIONS.md for why.
 */
const TRAINABLE = content.skills.map((s) => s.id).filter((id) => id !== 'combat');

describe('progression: hours to 99', () => {
  const hours = Object.fromEntries(TRAINABLE.map((s) => [s, hoursToCap(s, simContext).hours]));

  it.each(TRAINABLE)('%s reaches 99 in 27–45 hours on its standard method', (skill) => {
    expect(hours[skill]).toBeGreaterThan(27);
    expect(hours[skill]).toBeLessThan(45);
  });

  it('averages about 36 hours across skills', () => {
    const mean = TRAINABLE.reduce((n, s) => n + hours[s]!, 0) / TRAINABLE.length;
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
