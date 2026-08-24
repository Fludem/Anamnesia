/**
 * The halls: a clan's place on the hill, kept here because it is shared. Who founded what, who
 * is in it, who is asking at the door, how each room stands, and the ledger of every gift the
 * hall was offered. The sim never sees any of this but the answer to a save — which hall a
 * name is in, how the rooms stand, what was taken of the gifts on its cart — and the screen
 * reads the rest through the routes in app.ts. SQL for halls lives here and nowhere else.
 */
import type { DatabaseSync } from 'node:sqlite';
import type {
  HallGet,
  HallLedgerRow,
  HallMember,
  HallRoom,
  HallSummary,
  HallView,
  Petition,
  User,
} from '../src/api/protocol.ts';
import { isBlank, parseLook, type Look } from '../src/look/look.ts';
import type { SimContext } from '../src/sim/context.ts';
import type { Gift, HallSync } from '../src/sim/hall.ts';
import { nameKey } from './register.ts';

/** A hall holds at most this many names. */
export const MAX_MEMBERS = 20;
/** How many ledger rows a view carries. */
export const LEDGER_ROWS = 20;
/** The `what` of a gift of coins, in progress and the ledger (ids cannot start with `$`). */
export const GP = '$gp';

/** A gift as the ledger keeps it; `what` is the item id, or `GP` for coins. */
interface GiftRow {
  room: string;
  what: string;
  qty: number;
  taken: number;
}

/**
 * Whether the gift the ledger recorded under a number is the very gift now arriving under it:
 * the same thing, in the same amount, for the same room, and still on the cart the register
 * last saw. A save that has been reset counts from one again, and the gifts it sends under
 * those numbers are strangers to them.
 */
function sameGift(row: GiftRow, cart: Gift | undefined, what: string, qty: number): boolean {
  if (cart === undefined) return false;
  const carried = (cart.item ?? GP) === what && cart.qty === qty && cart.room === row.room;
  return carried && row.what === what && row.qty === qty;
}

/** A refusal with the status the route should answer. */
export class HallError extends Error {
  override readonly name = 'HallError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface HallRow {
  id: number;
  name: string;
  founder_id: number;
  created_at: number;
}

export class Halls {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ctx: SimContext,
  ) {}

  // ---- lookups ----------------------------------------------------------------------------

  /** The hall a name is in, or null. */
  hallOf(userId: number): HallRow | null {
    const row = this.db
      .prepare(
        `SELECT h.id, h.name, h.founder_id, h.created_at FROM members m
         JOIN halls h ON h.id = m.hall_id WHERE m.user_id = ?`,
      )
      .get(userId) as HallRow | undefined;
    return row ?? null;
  }

  private hallByName(name: string): HallRow | null {
    const row = this.db
      .prepare('SELECT id, name, founder_id, created_at FROM halls WHERE name_key = ?')
      .get(nameKey(name)) as HallRow | undefined;
    return row ?? null;
  }

  private userByName(name: string): User | null {
    const row = this.db
      .prepare('SELECT id, name, created_at FROM users WHERE name_key = ?')
      .get(nameKey(name)) as { id: number; name: string; created_at: number } | undefined;
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
  }

  private memberCount(hallId: number): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM members WHERE hall_id = ?').get(hallId) as {
        n: number;
      }
    ).n;
  }

  private roomsOf(hallId: number): Record<string, number> {
    const rows = this.db
      .prepare('SELECT room, tier FROM hall_rooms WHERE hall_id = ?')
      .all(hallId) as { room: string; tier: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) if (this.ctx.content.hasRoom(r.room)) out[r.room] = r.tier;
    return out;
  }

  private progressOf(hallId: number, room: string): Map<string, number> {
    const rows = this.db
      .prepare('SELECT what, qty FROM hall_progress WHERE hall_id = ? AND room = ?')
      .all(hallId, room) as { what: string; qty: number }[];
    return new Map(rows.map((r) => [r.what, r.qty]));
  }

  // ---- the door ---------------------------------------------------------------------------

  /** A name with no hall founds one. */
  found(user: User, name: string, nowMs: number): void {
    if (this.hallOf(user.id)) throw new HallError(409, 'You already have a hall.');
    if (this.hallByName(name)) throw new HallError(409, 'A hall by that name already stands.');
    const r = this.db
      .prepare(
        'INSERT INTO halls (name, name_key, founder_id, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      )
      .get(name.trim(), nameKey(name), user.id, nowMs) as { id: number };
    this.join(user.id, r.id, nowMs);
  }

  private join(userId: number, hallId: number, nowMs: number): void {
    this.db
      .prepare('INSERT INTO members (user_id, hall_id, joined_at) VALUES (?, ?, ?)')
      .run(userId, hallId, nowMs);
    this.db.prepare('DELETE FROM petitions WHERE user_id = ?').run(userId);
  }

  /** Any member may invite a name that has no hall; a request already waiting becomes a join. */
  invite(by: User, name: string, nowMs: number): 'invited' | 'joined' {
    const hall = this.hallOf(by.id);
    if (!hall) throw new HallError(409, 'You have no hall to invite anyone to.');
    const target = this.userByName(name);
    if (!target) throw new HallError(404, 'No one by that name on the hill.');
    if (target.id === by.id) throw new HallError(409, 'You are already here.');
    if (this.hallOf(target.id)) throw new HallError(409, `${target.name} already has a hall.`);
    if (this.memberCount(hall.id) >= MAX_MEMBERS) throw new HallError(409, 'The hall is full.');
    const waiting = this.db
      .prepare('SELECT kind FROM petitions WHERE hall_id = ? AND user_id = ?')
      .get(hall.id, target.id) as { kind: string } | undefined;
    if (waiting?.kind === 'request') {
      this.join(target.id, hall.id, nowMs);
      return 'joined';
    }
    if (!waiting) {
      this.db
        .prepare(
          `INSERT INTO petitions (hall_id, user_id, kind, by_user_id, created_at)
           VALUES (?, ?, 'invite', ?, ?)`,
        )
        .run(hall.id, target.id, by.id, nowMs);
    }
    return 'invited';
  }

  /** A name with no hall asks at a door; an invite already waiting becomes a join. */
  request(user: User, hallName: string, nowMs: number): 'requested' | 'joined' {
    if (this.hallOf(user.id)) throw new HallError(409, 'You already have a hall.');
    const hall = this.hallByName(hallName);
    if (!hall) throw new HallError(404, 'No hall by that name.');
    if (this.memberCount(hall.id) >= MAX_MEMBERS) throw new HallError(409, 'That hall is full.');
    const waiting = this.db
      .prepare('SELECT kind FROM petitions WHERE hall_id = ? AND user_id = ?')
      .get(hall.id, user.id) as { kind: string } | undefined;
    if (waiting?.kind === 'invite') {
      this.join(user.id, hall.id, nowMs);
      return 'joined';
    }
    if (!waiting) {
      this.db
        .prepare(
          `INSERT INTO petitions (hall_id, user_id, kind, by_user_id, created_at)
           VALUES (?, ?, 'request', ?, ?)`,
        )
        .run(hall.id, user.id, user.id, nowMs);
    }
    return 'requested';
  }

  /** The invited answers an invite; the founder answers a request. Either way it is settled. */
  answer(user: User, petitionId: number, accept: boolean, nowMs: number): void {
    const p = this.db
      .prepare('SELECT id, hall_id, user_id, kind FROM petitions WHERE id = ?')
      .get(petitionId) as
      { id: number; hall_id: number; user_id: number; kind: 'invite' | 'request' } | undefined;
    if (!p) throw new HallError(404, 'Nothing is waiting by that number.');
    const hall = this.db
      .prepare('SELECT id, name, founder_id, created_at FROM halls WHERE id = ?')
      .get(p.hall_id) as unknown as HallRow;
    // An invite is the invited's to answer; a request is the founder's, though whoever asked
    // may take it back.
    const mayAnswer =
      p.kind === 'invite'
        ? p.user_id === user.id
        : hall.founder_id === user.id || (p.user_id === user.id && !accept);
    if (!mayAnswer) throw new HallError(403, 'That is not yours to answer.');
    this.db.prepare('DELETE FROM petitions WHERE id = ?').run(p.id);
    if (!accept) return;
    if (this.hallOf(p.user_id)) throw new HallError(409, 'That name already has a hall.');
    if (this.memberCount(hall.id) >= MAX_MEMBERS) throw new HallError(409, 'The hall is full.');
    this.join(p.user_id, hall.id, nowMs);
  }

  /**
   * A name leaves. A founder leaving hands the keys to whoever has been there longest; the
   * last name out closes the hall. The ledger keeps its rows.
   */
  leave(user: User): void {
    const hall = this.hallOf(user.id);
    if (!hall) throw new HallError(409, 'You have no hall to leave.');
    this.db.prepare('DELETE FROM members WHERE user_id = ?').run(user.id);
    if (hall.founder_id !== user.id) return;
    const next = this.db
      .prepare('SELECT user_id FROM members WHERE hall_id = ? ORDER BY joined_at, user_id LIMIT 1')
      .get(hall.id) as { user_id: number } | undefined;
    if (next)
      this.db.prepare('UPDATE halls SET founder_id = ? WHERE id = ?').run(next.user_id, hall.id);
    else this.db.prepare('DELETE FROM halls WHERE id = ?').run(hall.id);
  }

  /** The founder shows a name the door. */
  expel(founder: User, name: string): void {
    const hall = this.hallOf(founder.id);
    if (!hall || hall.founder_id !== founder.id)
      throw new HallError(403, 'Only the founder turns anyone out.');
    const target = this.userByName(name);
    if (!target || this.hallOf(target.id)?.id !== hall.id)
      throw new HallError(404, 'No one by that name in the hall.');
    if (target.id === founder.id) throw new HallError(409, 'Leave, if you want to go.');
    this.db.prepare('DELETE FROM members WHERE user_id = ?').run(target.id);
  }

  /** The founder paints the mark over the door; null takes it down. */
  setLook(founder: User, look: Look | null): void {
    const hall = this.hallOf(founder.id);
    if (!hall || hall.founder_id !== founder.id)
      throw new HallError(403, 'Only the founder paints the mark.');
    this.db
      .prepare('UPDATE halls SET look = ? WHERE id = ?')
      .run(look === null || isBlank(look) ? null : JSON.stringify(look), hall.id);
  }

  /** The marks of some halls, keyed by the name as asked; a hall without one, or unknown, is null. */
  looksOf(names: readonly string[]): Record<string, Look | null> {
    const out: Record<string, Look | null> = {};
    const find = this.db.prepare('SELECT look FROM halls WHERE name_key = ?');
    for (const name of names) {
      const row = find.get(nameKey(name)) as { look: string | null } | undefined;
      out[name] = row ? parseLook(row.look) : null;
    }
    return out;
  }

  // ---- gifts ------------------------------------------------------------------------------

  /**
   * Take what the hall can of the gifts on a name's cart, in the caller's transaction. A gift
   * already in the ledger answers as it did the first time; a new one is taken only while the
   * name is in a hall, for the tier the gift was meant for, of something that tier wants, and
   * only as much as is still needed — the rest goes back. A tier whose every need is met
   * stands. `given` is the highest gift number the ledger knows, so a save cannot reuse one.
   */
  applyGifts(
    userId: number,
    gifts: readonly Gift[],
    recordGiven: number,
    pending: readonly Gift[],
    nowMs: number,
  ): HallSync {
    const hall = this.hallOf(userId);
    const took: { id: number; qty: number }[] = [];
    const known = this.db.prepare(
      'SELECT room, what, qty, taken FROM gifts WHERE user_id = ? AND gift_id = ?',
    );
    const cart = new Map(pending.map((g) => [g.id, g]));
    const insert = this.db.prepare(
      `INSERT INTO gifts (user_id, gift_id, hall_id, room, what, qty, taken, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const g of [...gifts].sort((a, b) => a.id - b.id)) {
      const what = g.item ?? GP;
      const seen = known.get(userId, g.id) as GiftRow | undefined;
      if (seen) {
        // The number is spent. If this is the very gift that spent it — the register's own copy
        // of the last cart still holds it, and the ledger row was written from it — the answer
        // is the one it gave before, so a reply that went missing costs nothing. Otherwise the
        // save has been reset or rolled back and is counting from one again over the ledger:
        // that gift is not the one this number bought, so it is sent back whole rather than
        // answered with a stranger's share, and the answer's `given` tells the save where the
        // count really is so its next gift is numbered past it.
        const resent = sameGift(seen, cart.get(g.id), what, g.qty);
        took.push({ id: g.id, qty: resent ? seen.taken : 0 });
        continue;
      }
      let taken = 0;
      let value = 0;
      if (hall && this.ctx.content.hasRoom(g.room)) {
        const room = this.ctx.content.room(g.room);
        const tier = this.roomsOf(hall.id)[room.id] ?? 0;
        const t = room.tiers[tier];
        if (t && g.tier === tier + 1) {
          const need =
            g.item === null
              ? t.coins
              : this.ctx.content.hasItem(g.item)
                ? (t.cost.find((c) => c.item === g.item)?.qty ?? 0)
                : 0;
          const progress = this.progressOf(hall.id, room.id);
          const remaining = Math.max(0, need - (progress.get(what) ?? 0));
          taken = Math.min(g.qty, remaining);
          if (taken > 0) {
            value = g.item === null ? taken : this.ctx.content.item(g.item).value * taken;
            this.db
              .prepare(
                `INSERT INTO hall_progress (hall_id, room, what, qty) VALUES (?, ?, ?, ?)
                 ON CONFLICT(hall_id, room, what) DO UPDATE SET qty = qty + excluded.qty`,
              )
              .run(hall.id, room.id, what, taken);
            const after = this.progressOf(hall.id, room.id);
            const done =
              t.cost.every((c) => (after.get(c.item) ?? 0) >= c.qty) &&
              (after.get(GP) ?? 0) >= t.coins;
            if (done) {
              this.db
                .prepare(
                  `INSERT INTO hall_rooms (hall_id, room, tier) VALUES (?, ?, ?)
                   ON CONFLICT(hall_id, room) DO UPDATE SET tier = excluded.tier`,
                )
                .run(hall.id, room.id, tier + 1);
              this.db
                .prepare('DELETE FROM hall_progress WHERE hall_id = ? AND room = ?')
                .run(hall.id, room.id);
            }
          }
        }
      }
      insert.run(userId, g.id, hall?.id ?? null, g.room, what, g.qty, taken, value, nowMs);
      took.push({ id: g.id, qty: taken });
    }
    return {
      id: hall?.id ?? null,
      rooms: hall ? this.roomsOf(hall.id) : {},
      took,
      given: Math.max(recordGiven, this.givenOf(userId)),
    };
  }

  /** The highest gift number this name's ledger has spent; a save may never reuse one. */
  private givenOf(userId: number): number {
    return (
      this.db
        .prepare('SELECT COALESCE(MAX(gift_id), 0) AS n FROM gifts WHERE user_id = ?')
        .get(userId) as { n: number }
    ).n;
  }

  // ---- reading ----------------------------------------------------------------------------

  /** The caller's hall as the screen shows it, with whatever is waiting at the door. */
  view(userId: number, nowMs: number): HallGet {
    const hall = this.hallOf(userId);
    if (!hall) {
      const invites = this.db
        .prepare(
          `SELECT p.id, h.name AS hall, u.name, p.created_at FROM petitions p
           JOIN halls h ON h.id = p.hall_id JOIN users u ON u.id = p.by_user_id
           WHERE p.user_id = ? AND p.kind = 'invite' ORDER BY p.created_at`,
        )
        .all(userId) as { id: number; hall: string; name: string; created_at: number }[];
      const asked = this.db
        .prepare(
          `SELECT p.id, h.name AS hall, u.name, p.created_at FROM petitions p
           JOIN halls h ON h.id = p.hall_id JOIN users u ON u.id = p.user_id
           WHERE p.user_id = ? AND p.kind = 'request' ORDER BY p.created_at`,
        )
        .all(userId) as { id: number; hall: string; name: string; created_at: number }[];
      const petition =
        (kind: 'invite' | 'request') =>
        (p: (typeof invites)[number]): Petition => ({
          id: p.id,
          kind,
          hall: p.hall,
          name: p.name,
          agoMs: Math.max(0, nowMs - p.created_at),
        });
      return {
        hall: null,
        invites: invites.map(petition('invite')),
        requests: asked.map(petition('request')),
      };
    }
    const members = (
      this.db
        .prepare(
          `SELECT u.id, u.name, s.god, s.updated_at,
                  (SELECT COALESCE(SUM(value), 0) FROM gifts g WHERE g.user_id = u.id AND g.hall_id = ?) AS given
           FROM members m JOIN users u ON u.id = m.user_id LEFT JOIN saves s ON s.user_id = u.id
           WHERE m.hall_id = ? ORDER BY m.joined_at, u.id`,
        )
        .all(hall.id, hall.id) as {
        id: number;
        name: string;
        god: string | null;
        updated_at: number | null;
        given: number;
      }[]
    ).map((m): HallMember => ({
      name: m.name,
      god: m.god,
      seenAgoMs: m.updated_at === null ? null : Math.max(0, nowMs - m.updated_at),
      given: m.given,
      founder: m.id === hall.founder_id,
      you: m.id === userId,
    }));
    const tiers = this.roomsOf(hall.id);
    const rooms: HallRoom[] = this.ctx.content.rooms.map((room) => {
      const tier = tiers[room.id] ?? 0;
      const next = room.tiers[tier];
      if (!next) return { room: room.id, tier, progress: [] };
      const progress = this.progressOf(hall.id, room.id);
      const needs = next.cost.map((c) => ({
        what: c.item,
        have: Math.min(c.qty, progress.get(c.item) ?? 0),
        need: c.qty,
      }));
      if (next.coins > 0)
        needs.push({
          what: GP,
          have: Math.min(next.coins, progress.get(GP) ?? 0),
          need: next.coins,
        });
      return { room: room.id, tier, progress: needs };
    });
    const ledger = (
      this.db
        .prepare(
          `SELECT u.name, g.room, g.what, g.taken, g.created_at FROM gifts g
           JOIN users u ON u.id = g.user_id
           WHERE g.hall_id = ? AND g.taken > 0 ORDER BY g.created_at DESC, g.gift_id DESC LIMIT ?`,
        )
        .all(hall.id, LEDGER_ROWS) as {
        name: string;
        room: string;
        what: string;
        taken: number;
        created_at: number;
      }[]
    ).map((r): HallLedgerRow => ({
      name: r.name,
      room: r.room,
      what: r.what,
      qty: r.taken,
      agoMs: Math.max(0, nowMs - r.created_at),
    }));
    const founder = members.find((m) => m.founder)?.name ?? '';
    const requests: Petition[] =
      hall.founder_id === userId
        ? (
            this.db
              .prepare(
                `SELECT p.id, u.name, p.created_at FROM petitions p JOIN users u ON u.id = p.user_id
                 WHERE p.hall_id = ? AND p.kind = 'request' ORDER BY p.created_at`,
              )
              .all(hall.id) as { id: number; name: string; created_at: number }[]
          ).map((p) => ({
            id: p.id,
            kind: 'request',
            hall: hall.name,
            name: p.name,
            agoMs: Math.max(0, nowMs - p.created_at),
          }))
        : [];
    const view: HallView = {
      id: hall.id,
      name: hall.name,
      founder,
      foundedAt: hall.created_at,
      members,
      rooms,
      ledger,
    };
    return { hall: view, invites: [], requests };
  }

  /** Every hall on the hill: most raised first, then most given, then the older. */
  list(): HallSummary[] {
    const rows = this.db
      .prepare(
        `SELECT h.name, h.created_at,
                (SELECT COUNT(*) FROM members m WHERE m.hall_id = h.id) AS members,
                (SELECT COALESCE(SUM(tier), 0) FROM hall_rooms r WHERE r.hall_id = h.id) AS raised,
                (SELECT COALESCE(SUM(value), 0) FROM gifts g WHERE g.hall_id = h.id) AS given
         FROM halls h ORDER BY raised DESC, given DESC, h.created_at ASC, h.id ASC`,
      )
      .all() as {
      name: string;
      created_at: number;
      members: number;
      raised: number;
      given: number;
    }[];
    return rows.map((r) => ({
      name: r.name,
      members: r.members,
      raised: r.raised,
      given: r.given,
      foundedAt: r.created_at,
    }));
  }
}
