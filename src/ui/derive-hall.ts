/**
 * Pure view helpers for the hall. Like derive.ts: the sim and the register's view in, rows
 * out, no React. The register knows the hall; the sim knows what this name holds and what is
 * still on the cart — a row needs both.
 */
import type { HallNeed, HallRoom, HallView } from '../api/protocol.ts';
import type { RoomDef, RoomPerk } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { hallPerks, roomTier, type Gift } from '../sim/hall.ts';
import { countItem } from '../sim/items.ts';
import type { SimState } from '../sim/save.ts';
import { formatInt } from './format.ts';

/** `$gp` in a need or the ledger means coins. */
export const GP = '$gp';

/** Roman, as a hall would carve it. */
export function numeral(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V'][n] ?? String(n);
}

/** One line for what a perk does: "+2% xp in every skill". */
export function perkLine(p: RoomPerk, ctx: SimContext): string {
  const pct = (f: number) => `${String(Math.round(f * 100))}%`;
  const skill = (id: string | null) =>
    id === null ? 'every skill' : ctx.content.hasSkill(id) ? ctx.content.skill(id).name : id;
  switch (p.kind) {
    case 'xp':
      return `+${pct(p.bonus)} xp in ${skill(p.skill)}`;
    case 'double-yield':
      return p.skill === null
        ? `gathering lands twice ${pct(p.chance)} of the time`
        : `${skill(p.skill)} lands twice ${pct(p.chance)} of the time`;
    case 'heal':
      return `food heals ${pct(p.bonus)} more`;
    case 'bank-slots':
      return `+${String(p.slots)} bank slots`;
    case 'night':
      return `the night lasts ${String(p.hours)} h longer`;
    case 'ferryman':
      return `the ferryman takes ${pct(p.discount)} less`;
  }
}

/** What the hall does for this name now, one line per raised room. */
export function perkLines(sim: SimState, ctx: SimContext): string[] {
  return hallPerks(sim, ctx).map((p) => perkLine(p, ctx));
}

/** A need as the row shows it: "120 Oak Logs", or "2,000 gp". */
export function needName(what: string, ctx: SimContext): string {
  if (what === GP) return 'gp';
  return ctx.content.hasItem(what) ? ctx.content.item(what).name : what;
}

export interface NeedRow extends HallNeed {
  name: string;
  /** How much of it this name holds (coins for `$gp`). */
  held: number;
  met: boolean;
}

export interface RoomRow {
  room: RoomDef;
  tier: number;
  /** The perk the room gives now, or null when unraised. */
  now: RoomPerk | null;
  /** The perk the next tier would give, or null at the top. */
  next: RoomPerk | null;
  needs: NeedRow[];
  /** How far the next tier is, 0..1 (1 at the top). */
  fraction: number;
  /** Whether this name holds anything the next tier still needs. */
  canGive: boolean;
  /** The sub line: "stands at II · next +2% xp in every skill". */
  sub: string;
}

/** The rooms in content order, with the register's progress and what this name could give. */
export function roomRows(view: HallView, sim: SimState, ctx: SimContext): RoomRow[] {
  const byRoom = new Map(view.rooms.map((r) => [r.room, r]));
  return ctx.content.rooms.map((room) => {
    const got: HallRoom = byRoom.get(room.id) ?? {
      room: room.id,
      tier: roomTier(sim, room.id),
      progress: [],
    };
    const tier = got.tier;
    const now = tier > 0 ? (room.tiers[Math.min(tier, room.tiers.length) - 1]?.perk ?? null) : null;
    const next = room.tiers[tier]?.perk ?? null;
    const needs: NeedRow[] = got.progress.map((n) => ({
      ...n,
      name: needName(n.what, ctx),
      held: n.what === GP ? sim.coins : countItem(sim.bank, n.what),
      met: n.have >= n.need,
    }));
    const total = needs.reduce((a, n) => a + n.need, 0);
    const have = needs.reduce((a, n) => a + Math.min(n.have, n.need), 0);
    const fraction = next === null ? 1 : total === 0 ? 0 : have / total;
    const canGive = needs.some((n) => !n.met && n.held > 0);
    const stands = tier === 0 ? 'not yet raised' : `stands at ${numeral(tier)}`;
    const sub = next === null ? `${stands} · finished` : `${stands} · next ${perkLine(next, ctx)}`;
    return { room, tier, now, next, needs, fraction, canGive, sub };
  });
}

/** One line for a need: "120 Oak Logs" with what is in so far. */
export function needLine(n: NeedRow): string {
  const name = n.what === GP ? 'gp' : n.name;
  return n.met
    ? `${formatInt(n.need)} ${name}`
    : `${formatInt(n.have)}/${formatInt(n.need)} ${name}`;
}

/** The gifts still on the cart, as lines: "200 Oak Logs for The Hearth". */
export function cartLines(gifts: readonly Gift[], ctx: SimContext): string[] {
  return gifts.map((g) => {
    const what = g.item === null ? 'gp' : needName(g.item, ctx);
    const room = ctx.content.hasRoom(g.room) ? ctx.content.room(g.room).name : g.room;
    return `${formatInt(g.qty)} ${what} for ${room}`;
  });
}

/** "3 h ago", "just now". */
export function agoLine(ms: number | null): string {
  if (ms === null) return 'never seen';
  const s = Math.floor(ms / 1000);
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 90) return `${String(m)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${String(h)} h ago`;
  const d = Math.floor(h / 24);
  return `${String(d)} d ago`;
}
