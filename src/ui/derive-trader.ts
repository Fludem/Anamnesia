/**
 * Pure view helpers for the trader and the ferryman. Like derive.ts: sim in, view out, no React.
 */
import { TICKS_PER_HOUR } from '../sim/constants.ts';
import type { ContentDb } from '../sim/content/db.ts';
import type { ItemDef, WareDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { LOSABLE_SLOTS } from '../sim/equipment.ts';
import type { SimEventOf } from '../sim/events.ts';
import type { SimState } from '../sim/save.ts';
import { formatInt } from './format.ts';
import { ferrymanCoins, ferrymanFee } from '../sim/skills/combat.ts';
import {
  offlineCapTicks,
  timesBought,
  warePrice,
  wareStatus,
  type WareStatus,
} from '../sim/trader.ts';

export interface WareRow {
  ware: WareDef;
  status: WareStatus;
  price: number;
  /** Whether the hero can pay it now (only meaningful for a ware for sale). */
  affordable: boolean;
  bought: number;
  /** The ware this one waits on, when locked. */
  needs: WareDef | null;
  /** What owning it does now, in the sub line: "the night lasts 16 h". */
  sub: string;
}

/** The wares in content order, each with its price, status and a line about its effect. */
export function wareRows(sim: SimState, ctx: SimContext): WareRow[] {
  const night = nightHours(sim, ctx);
  return ctx.content.wares.map((ware) => {
    const status = wareStatus(ware, sim);
    const price = warePrice(ware, sim);
    const bought = timesBought(sim, ware.id);
    const needs =
      status === 'locked' && ware.requires !== null ? ctx.content.ware(ware.requires) : null;
    let sub: string;
    switch (ware.effect.kind) {
      case 'offline-cap':
        sub =
          status === 'owned'
            ? `the night lasts ${String(night)} h`
            : `offline progress counts for ${String(ware.effect.hours)} h instead of ${String(night)}`;
        break;
      case 'second-look':
        sub =
          status === 'owned'
            ? 'the hill leaves twice as much'
            : 'skill capes turn up twice as often';
        break;
      case 'release-oath':
        sub =
          sim.player.god === null
            ? 'sworn to nobody'
            : bought === 0
              ? 'swear to another god; favour is kept'
              : `released ${String(bought)}× · favour is kept`;
        break;
    }
    return { ware, status, price, affordable: sim.coins >= price, bought, needs, sub };
  });
}

/** How long the night is: the offline cap in hours, lamp included. */
export function nightHours(sim: SimState, ctx: SimContext): number {
  return offlineCapTicks(sim, ctx) / TICKS_PER_HOUR;
}

export interface FerrymanView {
  paying: boolean;
  /** Obols in the bank. */
  obols: number;
  /** The dearest fee a death could cost now: twice the worth of the dearest worn losable item. */
  worstFee: number;
  worst: ItemDef | null;
}

export function ferrymanView(sim: SimState, ctx: SimContext): FerrymanView {
  const content = ctx.content;
  let worst: ItemDef | null = null;
  for (const slot of LOSABLE_SLOTS) {
    const id = sim.equipment[slot];
    if (id === null || !content.hasItem(id)) continue;
    const item = content.item(id);
    if (worst === null || item.value > worst.value) worst = item;
  }
  return {
    paying: sim.combat.ferryman,
    obols: ferrymanCoins(sim, ctx).reduce((n, s) => n + s.qty, 0),
    worstFee: worst === null ? 0 : ferrymanFee(worst, sim, ctx),
    worst,
  };
}

/** One line for a death: what went, what stayed and what it cost. */
export function deathLine(death: SimEventOf<'died'>, content: ContentDb): string {
  const name = (id: string) => (content.hasItem(id) ? content.item(id).name : id);
  if (death.kept !== null) {
    return death.obol
      ? `an obol paid the ferryman · your ${name(death.kept)} stays`
      : `the ferryman took ${formatInt(death.paid)} gp for your ${name(death.kept)}`;
  }
  if (death.lost !== null) return `the hill took your ${name(death.lost)}`;
  return 'the hill took nothing; you wore nothing';
}
