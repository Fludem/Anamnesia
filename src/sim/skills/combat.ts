import type { ActionHandler } from '../actions.ts';
import { roomFor } from '../bank.ts';
import {
  COMBAT_SKILL,
  FAVOUR_EVERY_TICKS,
  HITPOINTS_SKILL,
  HITPOINTS_XP_SHARE,
  SPLAT_CAP,
  activeBoon,
  heroStats,
  hitChance,
  maxHit,
  xpForDamage,
} from '../combat.ts';
import type { ItemDef, MonsterDef } from '../content/schema.ts';
import type { SimContext } from '../context.ts';
import { rollDropTable } from '../drops.ts';
import { LOSABLE_SLOTS } from '../equipment.ts';
import { pushEvent } from '../events.ts';
import { hallFerrymanDiscount, hallHealBonus } from '../hall.ts';
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
 * random; tools are never taken. Hitpoints refill on death — the item is the price, unless
 * the ferryman is paid: an obol in the bank settles the crossing, else twice the item's worth
 * in coins if the hero has it and has not told him otherwise. Then the item stays on.
 *
 * The sworn god watches the fight too: favour burns one a second while it runs, the god's
 * boon holds while there is any, and when it runs out one of the chosen offering is burnt
 * from the bank to buy more — the same shape as food.
 *
 * Ammo is the same shape again: the javelin in the ammo slot adds to the swing, and every
 * swing that lands throws one, taken from the bank's stock first; the one in the slot is the
 * last, and throwing it empties the slot.
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
  const healed = Math.round(heal * (1 + hallHealBonus(state, ctx)));
  const hp = Math.min(maxHp, state.combat.hp + healed);
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

/** Burn one of the chosen offering from the bank for its favour, if there is one. */
export function offer(state: SimState, ctx: SimContext): SimState | null {
  const offering = state.combat.offering;
  if (offering === null || !ctx.content.hasItem(offering)) return null;
  const favour = ctx.content.item(offering).stats.favour ?? 0;
  if (favour <= 0) return null;
  const bank = removeItem(state.bank, offering, 1);
  if (bank === null) return null;
  return pushEvent(
    {
      ...state,
      bank,
      combat: { ...state.combat, favour: state.combat.favour + favour },
      stats: { ...state.stats, offered: state.stats.offered + 1 },
    },
    { type: 'offered', tick: state.tick, item: offering, favour },
  );
}

/** How many of the chosen offering the bank holds. */
export function offeringsLeft(state: SimState): number {
  return state.combat.offering === null ? 0 : countItem(state.bank, state.combat.offering);
}

/**
 * A second of fighting: one favour burns, and when none is left an offering is burnt for
 * more, so the boon never lapses while the bank has offerings. With the regen boon, a
 * hitpoint comes back on its own clock.
 */
function favourTick(state: SimState, ctx: SimContext): SimState {
  let s = state;
  if (s.tick % FAVOUR_EVERY_TICKS === 0) {
    if (s.combat.favour > 0) s = { ...s, combat: { ...s.combat, favour: s.combat.favour - 1 } };
    if (s.combat.favour === 0) s = offer(s, ctx) ?? s;
  }
  const boon = activeBoon(s, ctx);
  if (boon !== null && boon.kind === 'regen' && s.tick % boon.everyTicks === 0) {
    const { maxHp } = heroStats(s, ctx);
    if (s.combat.hp < maxHp) s = { ...s, combat: { ...s.combat, hp: s.combat.hp + 1 } };
  }
  return s;
}

/** How many more of the equipped ammo the bank holds (0 with nothing in the slot). */
export function ammoLeft(state: SimState): number {
  return state.equipment.ammo === null ? 0 : countItem(state.bank, state.equipment.ammo);
}

/** A swing landed: one javelin goes, from the bank while it has any, then the one in hand. */
function throwAmmo(state: SimState): SimState {
  const ammo = state.equipment.ammo;
  if (ammo === null) return state;
  const bank = removeItem(state.bank, ammo, 1);
  const thrown = { ...state, stats: { ...state.stats, thrown: state.stats.thrown + 1 } };
  return bank === null
    ? { ...thrown, equipment: { ...thrown.equipment, ammo: null } }
    : { ...thrown, bank };
}

/** The ferryman charges this many times what the thing is worth. */
export const FERRYMAN_MULTIPLIER = 2;
/** A bank item with this tag settles a crossing outright. */
export const FERRYMAN_COIN_TAG = 'coin';

/** Twice the thing's worth, less what the hall's pyre knocks off. */
export function ferrymanFee(item: ItemDef, state: SimState, ctx: SimContext): number {
  return Math.round(FERRYMAN_MULTIPLIER * item.value * (1 - hallFerrymanDiscount(state, ctx)));
}

/** The obols in the bank, dearest first is not a thing: any one will do. */
export function ferrymanCoins(state: SimState, ctx: SimContext): ItemStack[] {
  return state.bank.filter(
    (s) => ctx.content.hasItem(s.item) && ctx.content.item(s.item).tags.includes(FERRYMAN_COIN_TAG),
  );
}

/**
 * The hero falls: one worn body item is picked (uniformly among the filled slots; the javelin
 * in hand is not worth taking) and the ferryman is offered for it — an obol from the bank
 * first, then twice its worth in coins if the hero pays and can — else it is lost. The fight
 * and the whole action queue end and hitpoints refill. Pure; the rng draw is the slot pick.
 */
function die(state: SimState, m: MonsterDef, ctx: SimContext): SimState {
  const worn = LOSABLE_SLOTS.filter((s) => state.equipment[s] !== null);
  let rng = state.rng;
  let lost: string | null = null;
  let kept: string | null = null;
  let paid = 0;
  let obol = false;
  let equipment = state.equipment;
  let bank = state.bank;
  let coins = state.coins;
  if (worn.length > 0) {
    let i;
    [i, rng] = nextInt(rng, 0, worn.length - 1);
    const slot = worn[i]!;
    const item = equipment[slot]!;
    const fee = ctx.content.hasItem(item) ? ferrymanFee(ctx.content.item(item), state, ctx) : 0;
    const coin = ferrymanCoins(state, ctx)[0];
    if (coin !== undefined) {
      bank = removeItem(bank, coin.item, 1) ?? bank;
      kept = item;
      obol = true;
    } else if (state.combat.ferryman && coins >= fee) {
      coins -= fee;
      kept = item;
      paid = fee;
    } else {
      lost = item;
      equipment = { ...equipment, [slot]: null };
    }
  }
  const ferried = kept === null ? 0 : 1;
  const { maxHp } = heroStats({ ...state, equipment }, ctx);
  return pushEvent(
    {
      ...state,
      rng,
      equipment,
      bank,
      coins,
      action: { current: null, queue: [] },
      combat: { ...state.combat, hp: maxHp, fight: null },
      stats: {
        ...state.stats,
        deaths: state.stats.deaths + 1,
        spent: state.stats.spent + paid,
        ferried: state.stats.ferried + ferried,
      },
    },
    { type: 'died', tick: state.tick, monster: m.id, lost, kept, paid, obol },
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
    const room = roomFor(state, wants, ctx);
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
    let s = favourTick(ensureFight(state, m), ctx);
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
    if (success) s = throwAmmo(s);
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
