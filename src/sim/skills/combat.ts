import type { ActionHandler } from '../actions.ts';
import { roomFor } from '../bank.ts';
import {
  BODY_SLOTS,
  COMBAT_SKILL,
  HITPOINTS_SKILL,
  HITPOINTS_XP_SHARE,
  SPLAT_CAP,
  heroStats,
  hitChance,
  maxHit,
  xpForDamage,
} from '../combat.ts';
import type { MonsterDef } from '../content/schema.ts';
import type { SimContext } from '../context.ts';
import { rollDropTable } from '../drops.ts';
import { pushEvent } from '../events.ts';
import { addStacks, countItem, removeItem, type ItemStack } from '../items.ts';
import { awardXp, recordItems, xpAwarded } from '../perks.ts';
import { skillLevel } from '../progress.ts';
import { nextFloat, nextInt } from '../rng.ts';
import type { Fight, SimState, Splat } from '../save.ts';

/**
 * Combat on the action primitive: a cycle is one of the hero's swings (duration = swing
 * speed, success = hit chance, resolve = damage and, when the monster falls, the kill). The
 * monster swings on its own clock inside the per-tick hook, which is also where the hero
 * eats and, at 0 hp, dies. Death ends the action and costs one worn body item, chosen at
 * random; tools are never taken. Hitpoints refill on death — the item is the price.
 */

function monsterOf(ctx: SimContext, id: string): MonsterDef {
  return ctx.content.monster(id);
}

function pushSplat(fight: Fight, splat: Splat): Fight {
  const splats = [...fight.splats, splat].slice(-SPLAT_CAP);
  return { ...fight, splats };
}

function freshFight(m: MonsterDef, tick: number, splats: Splat[] = []): Fight {
  return { monster: m.id, hp: m.hp, swingIn: m.stats.speed, startedTick: tick, splats };
}

/** The fight for `m`, started now if there is none or it was with someone else. */
function ensureFight(state: SimState, m: MonsterDef): SimState {
  const fight = state.combat.fight;
  if (fight !== null && fight.monster === m.id) return state;
  return { ...state, combat: { ...state.combat, fight: freshFight(m, state.tick) } };
}

/** Eat one of the chosen food from the bank, if there is any and it would do anything. */
export function eat(state: SimState, ctx: SimContext): SimState | null {
  const food = state.combat.food;
  if (food === null || !ctx.content.hasItem(food)) return null;
  const heal = ctx.content.item(food).stats.heal ?? 0;
  if (heal <= 0) return null;
  const { maxHp } = heroStats(state, ctx);
  if (state.combat.hp >= maxHp) return null;
  const bank = removeItem(state.bank, food, 1);
  if (bank === null) return null;
  const hp = Math.min(maxHp, state.combat.hp + heal);
  const fight = state.combat.fight;
  return {
    ...state,
    bank,
    combat: {
      ...state.combat,
      hp,
      fight:
        fight === null
          ? null
          : pushSplat(fight, {
              tick: state.tick,
              side: 'you',
              kind: 'heal',
              amount: hp - state.combat.hp,
            }),
    },
  };
}

/** How many of the chosen food the bank holds. */
export function foodLeft(state: SimState): number {
  return state.combat.food === null ? 0 : countItem(state.bank, state.combat.food);
}

/**
 * The hero falls: one worn body item is lost (uniformly among the filled slots), the fight
 * and the whole action queue end, and hitpoints refill. Pure; the rng draw is the slot pick.
 */
function die(state: SimState, m: MonsterDef, ctx: SimContext): SimState {
  const worn = BODY_SLOTS.filter((s) => state.equipment[s] !== null);
  let rng = state.rng;
  let lost: string | null = null;
  let equipment = state.equipment;
  if (worn.length > 0) {
    let i;
    [i, rng] = nextInt(rng, 0, worn.length - 1);
    const slot = worn[i]!;
    lost = equipment[slot] ?? null;
    equipment = { ...equipment, [slot]: null };
  }
  const { maxHp } = heroStats({ ...state, equipment }, ctx);
  return pushEvent(
    {
      ...state,
      rng,
      equipment,
      action: { current: null, queue: [] },
      combat: { ...state.combat, hp: maxHp, fight: null },
    },
    { type: 'died', tick: state.tick, monster: m.id, lost },
  );
}

/** The monster's swing: the hero eats first if low, then takes the hit, then may die. */
function monsterSwing(state: SimState, m: MonsterDef, ctx: SimContext): SimState {
  let s = state;
  const hero = heroStats(s, ctx);
  if (s.combat.hp < s.combat.eatAt * hero.maxHp) s = eat(s, ctx) ?? s;
  const [f, rolled] = nextFloat(s.rng);
  let rng = rolled;
  let amount = 0;
  if (f < hitChance(m.stats.attack, hero.defence)) {
    [amount, rng] = nextInt(rng, 1, maxHit(m.stats.strength));
  }
  const hp = Math.max(0, s.combat.hp - amount);
  const fight = pushSplat(
    { ...s.combat.fight!, swingIn: m.stats.speed },
    { tick: s.tick, side: 'you', kind: amount > 0 ? 'hit' : 'miss', amount },
  );
  s = { ...s, rng, combat: { ...s.combat, hp, fight } };
  return hp === 0 ? die(s, m, ctx) : s;
}

/** Xp for damage dealt: combat gets the share, hitpoints a third of it. */
function payForDamage(state: SimState, m: MonsterDef, dealt: number, ctx: SimContext): SimState {
  const base = xpForDamage(m, dealt);
  const paid = awardXp(state, COMBAT_SKILL, base, ctx);
  return awardXp(paid.state, HITPOINTS_SKILL, base * HITPOINTS_XP_SHARE, ctx).state;
}

/** The kill: drops, coins, the counter and the event; then a fresh monster of the same kind. */
function kill(state: SimState, m: MonsterDef, ctx: SimContext): SimState {
  let rng = state.rng;
  let landed: ItemStack[] = addStacks([], m.always);
  for (const table of m.drops) {
    let stacks;
    [stacks, rng] = rollDropTable(table, rng);
    landed = addStacks(landed, stacks);
  }
  let coins = 0;
  if (m.coins[1] > 0) [coins, rng] = nextInt(rng, m.coins[0], m.coins[1]);
  let s: SimState = {
    ...state,
    rng,
    bank: addStacks(state.bank, landed),
    coins: state.coins + coins,
  };
  s = recordItems(s, landed);
  const kills = { ...s.stats.kills, [m.id]: (s.stats.kills[m.id] ?? 0) + 1 };
  s = { ...s, stats: { ...s.stats, kills } };
  s = pushEvent(s, {
    type: 'kill',
    tick: s.tick,
    monster: m.id,
    xp: xpAwarded(s, COMBAT_SKILL, m.xp, ctx),
    items: landed,
    coins,
  });
  // The next one steps up; the last numbers stay so the bars can finish popping them.
  return { ...s, combat: { ...s.combat, fight: freshFight(m, s.tick, s.combat.fight!.splats) } };
}

export const combatHandler: ActionHandler<'combat'> = {
  canStart(state, req, ctx) {
    if (!ctx.content.hasMonster(req.monster)) {
      return { ok: false, reason: `unknown monster "${req.monster}"` };
    }
    const m = monsterOf(ctx, req.monster);
    const zone = ctx.content.zone(m.zone);
    const level = skillLevel(state, COMBAT_SKILL, ctx);
    if (level < zone.level) {
      return {
        ok: false,
        reason: `${zone.name} wants Combat level ${String(zone.level)} (you are ${String(level)})`,
      };
    }
    if (state.combat.hp === 0) return { ok: false, reason: 'no hitpoints left' };
    const wants = [
      ...m.always.map((a) => a.item),
      ...m.drops.flatMap((t) => t.entries.map((e) => e.item)),
    ];
    const room = roomFor(state, wants);
    if (!room.ok) {
      return {
        ok: false,
        reason: `bank is full (no slot for ${ctx.content.item(room.item).name})`,
      };
    }
    return { ok: true };
  },

  durationTicks(state, _req, ctx) {
    return heroStats(state, ctx).swingTicks;
  },

  successChance(state, req, ctx) {
    const m = monsterOf(ctx, req.monster);
    return hitChance(heroStats(state, ctx).attack, m.stats.defence);
  },

  tick(state, req, ctx) {
    const m = monsterOf(ctx, req.monster);
    let s = ensureFight(state, m);
    const fight = s.combat.fight!;
    if (fight.swingIn > 1) {
      return { ...s, combat: { ...s.combat, fight: { ...fight, swingIn: fight.swingIn - 1 } } };
    }
    s = { ...s, combat: { ...s.combat, fight: { ...fight, swingIn: 0 } } };
    return monsterSwing(s, m, ctx);
  },

  resolve(state, req, success, ctx) {
    const m = monsterOf(ctx, req.monster);
    let s = ensureFight(state, m);
    let rng = s.rng;
    let amount = 0;
    if (success) [amount, rng] = nextInt(rng, 1, maxHit(heroStats(s, ctx).strength));
    const dealt = Math.min(amount, s.combat.fight!.hp);
    const fight = pushSplat(
      { ...s.combat.fight!, hp: s.combat.fight!.hp - dealt },
      { tick: s.tick, side: 'them', kind: amount > 0 ? 'hit' : 'miss', amount },
    );
    s = { ...s, rng, combat: { ...s.combat, fight } };
    if (dealt > 0) s = payForDamage(s, m, dealt, ctx);
    return fight.hp === 0 ? kill(s, m, ctx) : s;
  },
};

/** Out of combat, hitpoints come back slowly. In a fight, only food helps. */
export function regenTick(state: SimState, ctx: SimContext, every: number): SimState {
  if (state.action.current?.request.kind === 'combat') return state;
  if (state.tick % every !== 0) return state;
  const { maxHp } = heroStats(state, ctx);
  if (state.combat.hp >= maxHp) return state;
  return { ...state, combat: { ...state.combat, hp: state.combat.hp + 1 } };
}
