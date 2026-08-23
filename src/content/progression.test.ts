import { describe, expect, it } from 'vitest';
import {
  coinsPerHour,
  combatClimb,
  GEAR_LADDER,
  hoursForTier,
  hoursToCap,
  hoursToMake,
  regenPerHour,
  ROOM_TIER_LEVELS as TIER_LEVELS,
} from '../sim/progression.ts';
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
    const all = [
      ...TRAINABLE.map((s) => hours[s]!),
      combatClimb(simContext).hours,
      combatClimb(simContext, { style: 'sorcery' }).hours,
    ];
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

  /** Pinned in scripts/tune-gear.ts: a slot's worth of numbers for a bar every minute or so. */
  it('the tier’s javelins take 5–15% off the climb and cost 40–60 bars an hour at every tier', () => {
    const armed = combatClimb(simContext, { ammo: true });
    const hours = (armed.hours - climb.hours) / climb.hours;
    expect(hours).toBeLessThan(-0.05);
    expect(hours).toBeGreaterThan(-0.15);
    for (const step of GEAR_LADDER) {
      const row = armed.steps.find((s) => s.level === step.level)!;
      const recipe = content.recipe(`${step.tier}-javelin`);
      const perBar = recipe.outputs[0]!.qty;
      const bars = row.hitsPerHour / perBar;
      expect(bars, step.tier).toBeGreaterThan(40);
      expect(bars, step.tier).toBeLessThan(60);
    }
  });

  it('every monster is the better xp for the style it is weak to', () => {
    // Each style's climb picks a monster weak to it at (nearly) every level: the roster gives
    // both fights something to do in every zone, not one zone each.
    const sorcery = combatClimb(simContext, { style: 'sorcery' });
    for (const c of [climb, sorcery]) {
      const weakSteps = c.steps.filter((s) => s.weak).length;
      expect(weakSteps / c.steps.length).toBeGreaterThan(0.8);
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

/**
 * Sorcery is the other fight: the tier's staff and a mark burnt on every landed cast, against
 * the same roster. It climbs a little quicker than the sword because every cast is paid for
 * in ore and ash — the quick-method tradeoff, in a fight.
 */
describe('progression: sorcery', () => {
  const melee = combatClimb(simContext);
  const climb = combatClimb(simContext, { style: 'sorcery' });

  it('reaches 99 in 27–45 hours casting in ladder gear, a little quicker than the sword', () => {
    expect(climb.hours).toBeGreaterThan(27);
    expect(climb.hours).toBeLessThan(45);
    expect(climb.milestones[10]).toBeLessThan(10 / 60);
    expect(climb.milestones[50]).toBeLessThan(2);
    const saved = (melee.hours - climb.hours) / melee.hours;
    expect(saved).toBeGreaterThan(0.02);
    expect(saved).toBeLessThan(0.15);
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

  it('casting burns 700–1,200 marks an hour: 35–60 ore and 35–120 ash at every tier', () => {
    for (const step of GEAR_LADDER) {
      const row = climb.steps.find((s) => s.level === step.level)!;
      const recipe = content.recipe(`${step.tier}-marks`);
      const recipes = row.hitsPerHour / recipe.outputs[0]!.qty;
      const ash = recipe.inputs.find((i) => i.item === 'ash')?.qty ?? 0;
      const ore = recipe.inputs.filter((i) => i.item !== 'ash').reduce((n, i) => n + i.qty, 0);
      expect(row.hitsPerHour, step.tier).toBeGreaterThan(700);
      expect(row.hitsPerHour, step.tier).toBeLessThan(1200);
      expect(recipes * ore, step.tier).toBeGreaterThan(35);
      expect(recipes * ore, step.tier).toBeLessThan(60);
      expect(recipes * ash, step.tier).toBeGreaterThan(35);
      expect(recipes * ash, step.tier).toBeLessThan(120);
    }
  });

  it('inscribing to 99 eats less of the hill than smithing does', () => {
    // The feeder is always less than the skill: fewer ore than the anvil wants, and less ash
    // than a firemaking climb makes.
    const marks = hoursToCap('sorcery', simContext);
    const bars = hoursToCap('smithing', simContext);
    const ate = (c: { actions: Record<string, number> }, item: string) => {
      let n = 0;
      for (const [id, cycles] of Object.entries(c.actions)) {
        for (const i of content.recipe(id).inputs) if (i.item === item) n += i.qty * cycles;
      }
      return n;
    };
    const oreFor = (c: { actions: Record<string, number> }) =>
      content.items.filter((i) => i.tags.includes('mining')).reduce((n, i) => n + ate(c, i.id), 0);
    expect(oreFor(marks)).toBeLessThan(oreFor(bars) / 2);
    const fires = hoursToCap('firemaking', simContext);
    const ashMade = Object.values(fires.actions).reduce((n, c) => n + c, 0);
    expect(ate(marks, 'ash')).toBeLessThan(ashMade);
  });
});

/**
 * The trader's prices against income. "Income" is coins per hour selling everything the best
 * standard method lands; each lamp should cost about an hour of it where the lamp is meant to
 * be bought, so it is a purchase and not a milestone. The ferryman is the sink that keeps
 * pace past that: twice the worth of what is worn, whatever the tier.
 */
describe('progression: the trader', () => {
  const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];
  const best = (level: number) =>
    Math.max(...GATHERING.map((s) => coinsPerHour(s, level, simContext)));

  it('income rises with level, and the first lamp is an evening of work at level 20', () => {
    let last = 0;
    for (const level of [1, 10, 20, 30, 45, 60, 75, 90]) {
      const gp = best(level);
      expect(gp, String(level)).toBeGreaterThanOrEqual(last);
      last = gp;
    }
    expect(content.ware('lamp').price).toBeLessThanOrEqual(best(20) * 2);
  });

  it('each rung of the lamp ladder costs a real stretch of the best income at its level', () => {
    // The night is short bare (4 h) and the lamps are what coins are for: each rung costs more
    // hours than the one before, the last about a day's income at level 75.
    const at: Record<string, number> = { lamp: 20, 'lamp-oil': 45, 'long-wick': 75 };
    let last = 0;
    for (const [id, level] of Object.entries(at)) {
      const hours = content.ware(id).price / best(level);
      expect(hours, id).toBeGreaterThan(last);
      expect(hours, id).toBeLessThanOrEqual(10);
      last = hours;
    }
    expect(last).toBeGreaterThanOrEqual(6);
    expect(content.ware('long-wick').price).toBe(1_000_000);
  });
});

describe('progression: the hall', () => {
  it('every material a room asks for can be come by at the tier level', () => {
    content.rooms.forEach((room) =>
      room.tiers.forEach((t, i) => {
        for (const c of t.cost) {
          const hours = hoursToMake(c.item, c.qty, TIER_LEVELS[i]!, simContext);
          expect(Number.isFinite(hours), `${room.id} ${String(i + 1)}: ${c.item}`).toBe(true);
        }
      }),
    );
  });

  it('one name raises a tier in an evening, a couple of days, a week or more — a hall shares that', () => {
    const bounds: [number, number][] = [
      [2.5, 5],
      [12, 30],
      [40, 120],
    ];
    for (const room of content.rooms) {
      room.tiers.forEach((t, i) => {
        const hours = hoursForTier(t, TIER_LEVELS[i]!, simContext);
        const [low, high] = bounds[i]!;
        expect(hours, `${room.id} ${String(i + 1)}`).toBeGreaterThanOrEqual(low);
        expect(hours, `${room.id} ${String(i + 1)}`).toBeLessThanOrEqual(high);
      });
    }
  });
});
