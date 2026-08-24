import { z } from 'zod';
import {
  HP_PER_LEVEL_OFFSET,
  HITPOINTS_SKILL,
  STYLE_SKILL,
  gearStats,
  heroStatsFrom,
  hitChance,
  maxHit,
  styleOf,
} from './combat.ts';
import type { CombatStyle } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { wornBodyItems } from './equipment.ts';
import { pushEvent } from './events.ts';
import { addItem, countItem, removeItem } from './items.ts';
import { skillLevel } from './progress.ts';
import { nextInt, seedRng, type RngState } from './rng.ts';
import type { EquipmentSlot, SimState } from './save.ts';

/**
 * The ring (Phase 19). One name calls another out and the register — not either client —
 * fights the two stored saves and says who won. The loser gives up the thing that was played
 * for; the winner takes it. Nobody has to be online: a bout is answered the moment it is
 * called, against the save the hill last saw.
 *
 * This file is the half both ends share. `fightBout` is the fight itself, and the register
 * runs it to decide the bout while the screen runs it to draw the same blows — so the replay
 * cannot disagree with the verdict, because it is not a retelling, it is the same function
 * over the same numbers. That is why a bout is fought on two resolved `Fighter` blocks and a
 * drawn seed, all three kept on the register's row: a save can change and content can ship
 * again, and the bout still replays exactly as it was paid out.
 *
 * The ring takes the numbers as worn — the style's level, hitpoints, and everything in a body
 * slot — and nothing whatever from the bank. No food, no favour, no god's boon, no ammo spent.
 * There is nothing here to stockpile, and one sentence explains the whole of it.
 *
 * Determinism: `fightBout` draws only from the seed it is handed and never touches the save's
 * own rng, so a bout can be replayed a thousand times, on either end, without moving the sim
 * one tick. Nothing here uses `Math.pow` or compares two floats — swings are integers and the
 * tiebreak is cross-multiplied.
 */

/** However long two turtles circle each other, a bout ends. Ticks, not swings: they differ. */
export const MAX_BOUT_TICKS = 6_000;
/** A name may be called out this often, by anyone. The hill is not a larder. */
export const CALLED_COOLDOWN_MS = 4 * 60 * 60 * 1000;
/** And may do the calling this often. */
export const CALLER_COOLDOWN_MS = 60 * 60 * 1000;
/** A name the hill has not seen for this long is out of the ring: you fight the living. */
export const SEEN_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A fighter as the ring sees them: integers, no content ids, no save. Everything `fightBout`
 * needs and nothing it does not, so a bout row can hold both sides forever.
 */
export const FighterSchema = z.object({
  name: z.string().min(1),
  attack: z.number().int().min(1),
  strength: z.number().int().min(1),
  defence: z.number().int().min(1),
  /** Ticks between this side's swings. */
  swingTicks: z.number().int().min(1),
  maxHp: z.number().int().min(1),
  /** Carried for the screen's stat line only; the fight itself never reads it. */
  style: z.enum(['melee', 'sorcery']),
});
export type Fighter = z.infer<typeof FighterSchema>;

/** One blow, in the order it landed. `at` is the tick within the bout. */
export const SwingSchema = z.object({
  at: z.number().int().min(0),
  by: z.enum(['caller', 'called']),
  hit: z.boolean(),
  amount: z.number().int().min(0),
  /** The struck side's hitpoints after it. */
  left: z.number().int().min(0),
});
export type Swing = z.infer<typeof SwingSchema>;

export const BoutResultSchema = z.object({
  swings: z.array(SwingSchema),
  winner: z.enum(['caller', 'called']),
  /** Hitpoints left, caller first. */
  left: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  /** True when the cap ran out and the hitpoints fraction decided it. */
  onPoints: z.boolean(),
});
export type BoutResult = z.infer<typeof BoutResultSchema>;

/**
 * The fight. Each side swings on its own clock; a tick where both are due resolves the caller
 * first, and a side that falls on that tick still does not swing back. Damage is uniform in
 * 1..maxHit, exactly as it is against a monster — there is no weakness bonus, because a
 * monster has a weakness and a person does not.
 *
 * Runs out of ticks and neither has fallen: whoever kept more of their hitpoints takes it,
 * compared by cross-multiplication so no float decides a bout. Dead level, and the called
 * holds — the caller came to put someone down and did not.
 */
export function fightBout(caller: Fighter, called: Fighter, seed: number): BoutResult {
  let rng: RngState = seedRng(seed);
  const swings: Swing[] = [];
  let hpCaller = caller.maxHp;
  let hpCalled = called.maxHp;
  // The first swing of each side falls on its own swing time, not on tick 0.
  let dueCaller = caller.swingTicks;
  let dueCalled = called.swingTicks;

  const swing = (by: 'caller' | 'called', at: number): void => {
    const [me, you] = by === 'caller' ? [caller, called] : [called, caller];
    const theirHp = by === 'caller' ? hpCalled : hpCaller;
    let landed = 0;
    let roll: number;
    // One draw for the swing, one for the damage — the same order as a monster's swing, so a
    // bout and a fight consume their seeds alike and neither can be told from the other.
    [roll, rng] = nextInt(rng, 1, 10_000);
    const hit = roll <= Math.round(hitChance(me.attack, you.defence) * 10_000);
    if (hit) {
      let amount: number;
      [amount, rng] = nextInt(rng, 1, maxHit(me.strength));
      landed = Math.min(amount, theirHp);
    }
    const left = theirHp - landed;
    if (by === 'caller') hpCalled = left;
    else hpCaller = left;
    swings.push({ at, by, hit, amount: landed, left });
  };

  for (let at = 1; at <= MAX_BOUT_TICKS; at++) {
    if (at === dueCaller) {
      swing('caller', at);
      dueCaller += caller.swingTicks;
    }
    if (hpCalled === 0) break;
    if (at === dueCalled) {
      swing('called', at);
      dueCalled += called.swingTicks;
    }
    if (hpCaller === 0) break;
  }

  if (hpCalled === 0) return { swings, winner: 'caller', left: [hpCaller, 0], onPoints: false };
  if (hpCaller === 0) return { swings, winner: 'called', left: [0, hpCalled], onPoints: false };
  // On points: hpCaller/caller.maxHp against hpCalled/called.maxHp, cross-multiplied.
  const winner = hpCaller * called.maxHp > hpCalled * caller.maxHp ? 'caller' : 'called';
  return { swings, winner, left: [hpCaller, hpCalled], onPoints: true };
}

/**
 * The fighter a save fields: the style's level, hitpoints, and the gear's sums. The boon is
 * passed as null deliberately — `heroStats` would fold in the god's while favour burns, and
 * favour is something the bank bought.
 */
export function fighterFrom(state: SimState, ctx: SimContext, name: string): Fighter {
  const worn = wornBodyItems(state, ctx);
  const style: CombatStyle = styleOf(worn);
  const stats = heroStatsFrom(
    skillLevel(state, STYLE_SKILL[style], ctx),
    skillLevel(state, HITPOINTS_SKILL, ctx),
    gearStats(worn, style),
    null,
    style,
  );
  return {
    name,
    attack: stats.attack,
    strength: stats.strength,
    defence: stats.defence,
    swingTicks: stats.swingTicks,
    maxHp: stats.maxHp,
    style,
  };
}

/** Hitpoints the hero can have at all, for the clamp after gear is taken off them. */
export function maxHpOf(state: SimState, ctx: SimContext): number {
  return skillLevel(state, HITPOINTS_SKILL, ctx) + HP_PER_LEVEL_OFFSET;
}

// ---- what the save carries -----------------------------------------------------------------

/**
 * The register owns every number here. It stamps `settledThrough` into the record it stores
 * the way it stamps the account's name, so a reset save cannot re-collect what it has already
 * paid and a forged one cannot claim to be square.
 */
export const BoutStateSchema = z.object({
  /** The highest settlement this save has taken. Register-owned; never trusted as a floor. */
  settledThrough: z.number().int().min(0),
  /** Owed and not yet paid, in coins. A name with an open balance is out of the ring. */
  owed: z.number().int().min(0).default(0),
});
export type BoutState = z.infer<typeof BoutStateSchema>;

export const NO_BOUTS: BoutState = { settledThrough: 0, owed: 0 };

/** One settlement the register has decided and the save has not yet taken. */
export const SettlementSchema = z.object({
  seq: z.number().int().min(1),
  /** Won: the item comes in. Lost: it goes, or its worth does. */
  won: z.boolean(),
  opponent: z.string().min(1),
  item: z.string().min(1),
  slot: z.string().min(1),
  /** What the register says is still owed on a loss after this settlement lands. */
  owed: z.number().int().min(0).default(0),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const BoutSyncSchema = z.object({
  /** Settlements newer than the save's `settledThrough`, oldest first. */
  settle: z.array(SettlementSchema),
  /** The high-water mark the register holds for this name. A save cannot fall behind it. */
  settledThrough: z.number().int().min(0),
  /** The balance the register holds. */
  owed: z.number().int().min(0),
});
export type BoutSync = z.infer<typeof BoutSyncSchema>;

export const NO_BOUT_SYNC: BoutSync = { settle: [], settledThrough: 0, owed: 0 };

/**
 * Take a worn or banked item off the hero, or its worth in coins when it is gone. The ladder
 * is the ferryman's: what is worn goes first, then what is banked, then twice its value in
 * coin, and what cannot be paid stays owed rather than being forgiven — otherwise selling the
 * thing you were about to lose would be the cheapest move in the game.
 *
 * Taking worn gear has the same knock-ons a death does, so it ends the same way: hitpoints are
 * clamped to what the remaining gear allows, and the action queue stops, because losing the
 * weapon can flip the style out from under a running action.
 */
function takeItem(
  state: SimState,
  item: string,
  slot: string,
  ctx: SimContext,
): { state: SimState; owed: number } {
  const value = ctx.content.hasItem(item) ? ctx.content.item(item).value : 0;
  const worn = state.equipment[slot as EquipmentSlot];
  if (worn === item) {
    const stripped: SimState = {
      ...state,
      equipment: { ...state.equipment, [slot]: null },
      action: { current: null, queue: [] },
      combat: { ...state.combat, fight: null },
    };
    const cap = maxHpOf(stripped, ctx);
    return {
      state: { ...stripped, combat: { ...stripped.combat, hp: Math.min(stripped.combat.hp, cap) } },
      owed: 0,
    };
  }
  if (countItem(state.bank, item) > 0) {
    return { state: { ...state, bank: removeItem(state.bank, item, 1) ?? state.bank }, owed: 0 };
  }
  // Gone. Twice its worth, as the ferryman asks, and the shortfall stays on the books.
  const asked = value * 2;
  const paid = Math.min(state.coins, asked);
  return {
    state: {
      ...state,
      coins: state.coins - paid,
      stats: { ...state.stats, spent: state.stats.spent + paid },
    },
    owed: asked - paid,
  };
}

/**
 * Apply what the register said. Settlements older than `settledThrough` are skipped, so a
 * re-sent answer is a no-op; the counters only ever climb. Returns the very same state object
 * when nothing changed, which is the contract `GameHost.applyAnswer` is held to.
 *
 * A won item comes into the bank unconditionally — a spoil is a thing returned unasked, like
 * gear taken off or a gift the hall would not have, and `bank.ts` already says those may leave
 * the bank a stack over. A spoil must never be the drop that evaporates.
 */
export function applyBoutSync(state: SimState, sync: BoutSync, ctx: SimContext): SimState {
  let s = state;
  let changed = false;
  let settledThrough = state.bouts.settledThrough;
  let short = 0;
  for (const settlement of [...sync.settle].sort((a, b) => a.seq - b.seq)) {
    if (settlement.seq <= settledThrough) continue;
    settledThrough = settlement.seq;
    changed = true;
    if (settlement.won) {
      s = {
        ...s,
        bank: addItem(s.bank, settlement.item, 1),
        stats: { ...s.stats, bouts: s.stats.bouts + 1, taken: s.stats.taken + 1 },
      };
    } else {
      const took = takeItem(s, settlement.item, settlement.slot, ctx);
      short += took.owed;
      s = {
        ...took.state,
        stats: {
          ...took.state.stats,
          bouts: took.state.stats.bouts + 1,
          lost: took.state.stats.lost + 1,
        },
      };
    }
    s = pushEvent(s, {
      type: 'bout',
      tick: s.tick,
      opponent: settlement.opponent,
      won: settlement.won,
      item: settlement.item,
      slot: settlement.slot,
    });
  }
  // What the ring is still owed: the register's standing figure, plus whatever this batch
  // could not pay, less whatever the purse can cover now. A balance is never forgiven, but it
  // is always collected the moment there is anything to collect it from — so a name that owes
  // works its way back into the ring rather than being shut out of it for good.
  let owed = Math.max(sync.owed, state.bouts.owed) + short;
  if (owed > 0 && s.coins > 0) {
    const paid = Math.min(s.coins, owed);
    owed -= paid;
    s = { ...s, coins: s.coins - paid, stats: { ...s.stats, spent: s.stats.spent + paid } };
    changed = true;
  }
  const mark = Math.max(settledThrough, sync.settledThrough);
  if (!changed && mark === state.bouts.settledThrough && owed === state.bouts.owed) return state;
  return { ...s, bouts: { settledThrough: mark, owed } };
}
