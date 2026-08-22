/**
 * Pure view helpers for Screen E (combat) and the equipment screen. Like derive.ts: no React,
 * no clock; the numbers the screens draw are computed here so tests can pin them.
 */
import { actionHandler } from '../sim/actions.ts';
import {
  BODY_SLOTS,
  FAVOUR_EVERY_TICKS,
  expectedKillTicks,
  heroStats,
  hitChance,
  maxHit,
  type HeroStats,
} from '../sim/combat.ts';
import { TICK_MS } from '../sim/constants.ts';
import type { ContentDb } from '../sim/content/db.ts';
import type { CombatBoon, GodDef, ItemDef, MonsterDef, ZoneDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { eventsOfType, type SimEventOf } from '../sim/events.ts';
import { countItem } from '../sim/items.ts';
import { godOf, xpAwarded } from '../sim/perks.ts';
import { skillLevel } from '../sim/progress.ts';
import type { SimState, Splat } from '../sim/save.ts';
import type { EquipmentSlot } from '../sim/slots.ts';
import { TICKS_PER_HOUR } from './derive.ts';

// ---- the fight ----------------------------------------------------------------------------

export interface SideView {
  name: string;
  sub: string;
  hp: number;
  maxHp: number;
  /** 0–1 through the swing. */
  swingFrac: number;
  swingSeconds: number;
  statsLine: string;
  splats: Splat[];
}

export interface FightView {
  monster: MonsterDef;
  zone: ZoneDef;
  you: SideView;
  them: SideView;
  /** Seconds since this monster stepped up. */
  fightSeconds: number;
  xpPerKill: number;
  xpHr: number;
  /** Expected seconds per kill, from the model. */
  killSeconds: number;
}

/** The numbers of a splat worth showing: younger than `withinTicks`. */
export const SPLAT_TICKS = 12;

/** The fight in front of the hero, or null when no combat action runs. */
export function fightView(sim: SimState, ctx: SimContext): FightView | null {
  const cur = sim.action.current;
  const fight = sim.combat.fight;
  if (cur === null || cur.request.kind !== 'combat' || fight === null) return null;
  const m = ctx.content.monster(fight.monster);
  const zone = ctx.content.zone(m.zone);
  const hero = heroStats(sim, ctx);
  const level = skillLevel(sim, 'combat', ctx);
  const xpPerKill = xpAwarded(sim, 'combat', m.xp, ctx);
  const killTicks = expectedKillTicks(hero, m);
  const fresh = (side: Splat['side']) =>
    fight.splats.filter((p) => p.side === side && sim.tick - p.tick < SPLAT_TICKS);
  return {
    monster: m,
    zone,
    you: {
      name: sim.player.name,
      sub: `you · Lv ${String(level)}`,
      hp: sim.combat.hp,
      maxHp: hero.maxHp,
      swingFrac: cur.elapsedTicks / cur.durationTicks,
      swingSeconds: (cur.durationTicks * TICK_MS) / 1000,
      statsLine: `atk ${String(hero.attack)} · str ${String(hero.strength)} · def ${String(hero.defence)}`,
      splats: fresh('you'),
    },
    them: {
      name: m.name,
      sub: `Lv ${String(m.level)} · ${zone.name.toLowerCase()}`,
      hp: fight.hp,
      maxHp: m.hp,
      swingFrac: 1 - fight.swingIn / m.stats.speed,
      swingSeconds: (m.stats.speed * TICK_MS) / 1000,
      statsLine: `max hit ${String(maxHit(m.stats.strength))} · ${String(xpPerKill)} xp per kill`,
      splats: fresh('them'),
    },
    fightSeconds: ((sim.tick - fight.startedTick) * TICK_MS) / 1000,
    xpPerKill,
    xpHr: (xpPerKill * TICKS_PER_HOUR) / killTicks,
    killSeconds: (killTicks * TICK_MS) / 1000,
  };
}

// ---- food ---------------------------------------------------------------------------------

export interface FoodView {
  item: ItemDef | null;
  have: number;
  heal: number;
}

export function foodView(sim: SimState, content: ContentDb): FoodView {
  const id = sim.combat.food;
  if (id === null || !content.hasItem(id)) return { item: null, have: 0, heal: 0 };
  const item = content.item(id);
  return { item, have: countItem(sim.bank, id), heal: item.stats.heal ?? 0 };
}

/** Everything in the bank that heals, best first. */
export function foodOptions(sim: SimState, content: ContentDb): FoodView[] {
  return sim.bank
    .filter((s) => content.hasItem(s.item) && (content.item(s.item).stats.heal ?? 0) > 0)
    .map((s) => {
      const item = content.item(s.item);
      return { item, have: s.qty, heal: item.stats.heal ?? 0 };
    })
    .sort((a, b) => b.heal - a.heal);
}

// ---- favour -------------------------------------------------------------------------------

export interface FavourView {
  god: GodDef | null;
  boon: CombatBoon | null;
  favour: number;
  /** Whether the boon is in effect (there is favour to burn). */
  lit: boolean;
  /** How long the favour lasts in a fight, in seconds. */
  seconds: number;
  offering: ItemDef | null;
  /** How many of the offering the bank holds. */
  have: number;
  /** Favour one offering buys. */
  each: number;
}

export function favourView(sim: SimState, ctx: SimContext): FavourView {
  const god = godOf(sim, ctx);
  const id = sim.combat.offering;
  const offering = id !== null && ctx.content.hasItem(id) ? ctx.content.item(id) : null;
  return {
    god,
    boon: god?.perks.combat ?? null,
    favour: sim.combat.favour,
    lit: sim.combat.favour > 0,
    seconds: (sim.combat.favour * FAVOUR_EVERY_TICKS * TICK_MS) / 1000,
    offering,
    have: offering === null ? 0 : countItem(sim.bank, offering.id),
    each: offering?.stats.favour ?? 0,
  };
}

/** Everything in the bank that can be burnt for favour, best first. */
export function offeringOptions(
  sim: SimState,
  content: ContentDb,
): { item: ItemDef; have: number; each: number }[] {
  return sim.bank
    .filter((s) => content.hasItem(s.item) && (content.item(s.item).stats.favour ?? 0) > 0)
    .map((s) => {
      const item = content.item(s.item);
      return { item, have: s.qty, each: item.stats.favour ?? 0 };
    })
    .sort((a, b) => b.each - a.each);
}

/** The boon as a number: "+50% defence", "1 hp every 6 s". */
export function boonText(boon: CombatBoon): string {
  if (boon.kind === 'regen') return `1 hp every ${String((boon.everyTicks * TICK_MS) / 1000)} s`;
  return `+${String(Math.round(boon.fraction * 100))}% ${boon.kind}`;
}

/** The most recent offering burnt within `withinTicks`, for the row to flash. */
export function recentOffering(sim: SimState, withinTicks: number): SimEventOf<'offered'> | null {
  const all = eventsOfType(sim, 'offered');
  const last = all[all.length - 1];
  return last !== undefined && sim.tick - last.tick < withinTicks ? last : null;
}

// ---- zones --------------------------------------------------------------------------------

export interface MonsterRow {
  monster: MonsterDef;
  maxHit: number;
  xp: number;
  /** Expected seconds per kill for the hero as they are now. */
  killSeconds: number;
  /** The hero's chance to land a swing on it. */
  hitChance: number;
  fighting: boolean;
}

export interface ZoneRow {
  zone: ZoneDef;
  locked: boolean;
  /** The current fight is here. */
  active: boolean;
  monsters: MonsterRow[];
}

export function zoneRows(sim: SimState, ctx: SimContext): ZoneRow[] {
  const level = skillLevel(sim, 'combat', ctx);
  const hero = heroStats(sim, ctx);
  const cur = sim.action.current?.request;
  const fighting = cur?.kind === 'combat' ? cur.monster : null;
  return ctx.content.zones.map((zone) => {
    const monsters = ctx.content.monstersIn(zone.id).map((m) => ({
      monster: m,
      maxHit: maxHit(m.stats.strength),
      xp: xpAwarded(sim, 'combat', m.xp, ctx),
      killSeconds: (expectedKillTicks(hero, m) * TICK_MS) / 1000,
      hitChance: hitChance(hero.attack, m.stats.defence),
      fighting: fighting === m.id,
    }));
    return {
      zone,
      locked: level < zone.level,
      active: monsters.some((m) => m.fighting),
      monsters,
    };
  });
}

// ---- the kill log -------------------------------------------------------------------------

export interface KillRow {
  key: string;
  monster: MonsterDef;
  xp: number;
  /** "Bone, Goat Hide, 2 gp" */
  items: string;
  /** The rarest thing that dropped, if anything above common. */
  rare: ItemDef | null;
  ageTicks: number;
}

export function killLog(sim: SimState, content: ContentDb, limit = 12): KillRow[] {
  const kills = eventsOfType(sim, 'kill');
  const rows: KillRow[] = [];
  for (let i = kills.length - 1; i >= 0 && rows.length < limit; i--) {
    const k = kills[i]!;
    const parts = k.items.map((s) => {
      const item = content.item(s.item);
      return s.qty > 1 ? `${String(s.qty)} ${item.name}` : item.name;
    });
    if (k.coins > 0) parts.push(`${String(k.coins)} gp`);
    let rare: ItemDef | null = null;
    for (const s of k.items) {
      const item = content.item(s.item);
      const rank = content.rarity(item.rarity).rank;
      if (rank > 0 && (rare === null || rank > content.rarity(rare.rarity).rank)) rare = item;
    }
    rows.push({
      key: String(k.tick),
      monster: content.monster(k.monster),
      xp: k.xp,
      items: parts.length > 0 ? parts.join(', ') : 'nothing',
      rare,
      ageTicks: sim.tick - k.tick,
    });
  }
  return rows;
}

export function totalKills(sim: SimState): number {
  return Object.values(sim.stats.kills).reduce((n, k) => n + k, 0);
}

/** The newest rare-or-better drop from a kill younger than `withinTicks`. */
export function recentRareKill(
  sim: SimState,
  content: ContentDb,
  withinTicks: number,
  minRank = 1,
): { item: ItemDef; tick: number } | null {
  const kills = eventsOfType(sim, 'kill');
  for (let i = kills.length - 1; i >= 0; i--) {
    const k = kills[i]!;
    if (sim.tick - k.tick >= withinTicks) return null;
    for (const s of k.items) {
      const item = content.item(s.item);
      if (content.rarity(item.rarity).rank >= minRank) return { item, tick: k.tick };
    }
  }
  return null;
}

/** The last death, if nothing has been fought since. */
export function lastDeath(sim: SimState): SimEventOf<'died'> | null {
  const deaths = eventsOfType(sim, 'died');
  const last = deaths[deaths.length - 1];
  if (!last) return null;
  const fought = eventsOfType(sim, 'kill').some((k) => k.tick > last.tick);
  return fought || sim.action.current?.request.kind === 'combat' ? null : last;
}

// ---- worn ---------------------------------------------------------------------------------

export interface WornSlotView {
  slot: EquipmentSlot;
  item: ItemDef | null;
}

export function wornBody(sim: SimState, content: ContentDb): WornSlotView[] {
  return BODY_SLOTS.map((slot) => {
    const id = sim.equipment[slot];
    return { slot, item: id !== null && content.hasItem(id) ? content.item(id) : null };
  });
}

/** Bank items that fit `slot`, best stat total first. */
export function bankItemsFor(sim: SimState, content: ContentDb, slot: EquipmentSlot): ItemDef[] {
  const total = (i: ItemDef) =>
    (i.stats.attack ?? 0) +
    (i.stats.strength ?? 0) +
    (i.stats.defence ?? 0) +
    (i.stats.gather ?? 0);
  return sim.bank
    .filter((s) => content.hasItem(s.item) && content.item(s.item).slot === slot)
    .map((s) => content.item(s.item))
    .sort((a, b) => total(b) - total(a));
}

export { heroStats, type HeroStats };

/** The hero's swing chance against a monster, for the zone rows. */
export function swingChance(sim: SimState, m: MonsterDef, ctx: SimContext): number {
  return actionHandler('combat').successChance(
    sim,
    { kind: 'combat', monster: m.id, count: null },
    ctx,
  );
}
