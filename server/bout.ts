import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  BoutRow,
  RingCalled,
  RingCard,
  RingGet,
  RingName,
  RingWorn,
  User,
} from '../src/api/protocol.ts';
import {
  CALLED_COOLDOWN_MS,
  CALLER_COOLDOWN_MS,
  NO_BOUT_SYNC,
  SEEN_WITHIN_MS,
  fightBout,
  fighterFrom,
  type BoutSync,
  type Fighter,
  type Settlement,
} from '../src/sim/bout.ts';
import { LOSABLE_SLOTS } from '../src/sim/equipment.ts';
import type { SimContext } from '../src/sim/context.ts';
import { migrateSave } from '../src/sim/migrate.ts';
import { reconcileWithContent } from '../src/sim/reconcile.ts';
import type { SaveRecord, SimState } from '../src/sim/save.ts';
import { skillLevel } from '../src/sim/progress.ts';
import { STYLE_SKILL } from '../src/sim/combat.ts';

/**
 * The ring: the one place on the hill where a name's loss is another name's doing, and so the
 * one place the register cannot take a save's word for the answer. It loads both stored saves,
 * works out both fighters itself, draws a seed with the process's own randomness and runs
 * `fightBout` (src/sim/bout.ts — the same function the screen replays it with). No client is
 * asked anything and no client is believed about anything except what it was wearing, which is
 * the honour system the boards and the hall already run on.
 *
 * What the register will not do is rewrite a save it is not being handed. Editing the loser's
 * stored record would move their `saveCounter` out from under their open tab, and their next
 * write would come back stale: losing a bout would put a player on the hold page. So a bout
 * writes a numbered settlement instead, and it is collected the next time that name's own save
 * comes through `writeSave` — on the incoming record, before it is stored. That is the one
 * shape that is both safe for a live tab and not a request: the client is told what happened,
 * it is not asked to agree.
 *
 * `bout_ledger` is why `settledThrough` and `owed` are the register's numbers and not the
 * save's. The wheel's `paidThrough` is read out of the record, which means a save reset to
 * zero is re-served its whole history; here the record's number is only ever an acknowledgement
 * and never a floor.
 */

/** Bouts a screen is shown. */
export const CARD = 12;
/** A shortfall is carried, not forgiven — but a balance this size bars a name from the ring. */
export const OWED_BARS_AT = 1;

export class BoutError extends Error {
  override readonly name = 'BoutError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface LedgerRow {
  settled_through: number;
  owed: number;
}

interface SettlementRow {
  seq: number;
  won: number;
  opponent: string;
  item: string;
  slot: string;
}

export class Ring {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ctx: SimContext,
    /** A uniform integer in [0, n); the process's own by default, fixed in tests. */
    private readonly random: (n: number) => number = randomInt,
  ) {}

  // ---- reading a save the register did not write ------------------------------------------

  /**
   * A stored record as this build understands it. Every row in `saves` is written by whatever
   * version was current when it was written, so it is migrated and reconciled before a single
   * number is read off it. A record that cannot be brought forward is not in the ring — never
   * a five hundred, and never a fight against numbers nothing here understands.
   */
  private simOf(userId: number): SimState | null {
    const row = this.db.prepare('SELECT record FROM saves WHERE user_id = ?').get(userId) as
      { record: string } | undefined;
    if (row === undefined) return null;
    try {
      const record = migrateSave(JSON.parse(row.record) as SaveRecord);
      return reconcileWithContent(record.sim, this.ctx.content).sim;
    } catch {
      return null;
    }
  }

  private ledger(userId: number): LedgerRow {
    const row = this.db
      .prepare('SELECT settled_through, owed FROM bout_ledger WHERE user_id = ?')
      .get(userId) as LedgerRow | undefined;
    return row ?? { settled_through: 0, owed: 0 };
  }

  /** Milliseconds until this name may call again, and until it may be called out again. */
  private rest(userId: number, nowMs: number): { caller: number; called: number } {
    const last = (column: 'caller_id' | 'called_id') =>
      (
        this.db
          .prepare(`SELECT COALESCE(MAX(created_at), 0) AS at FROM bouts WHERE ${column} = ?`)
          .get(userId) as { at: number }
      ).at;
    const left = (at: number, span: number) => Math.max(0, at + span - nowMs);
    return {
      caller: left(last('caller_id'), CALLER_COOLDOWN_MS),
      called: left(last('called_id'), CALLED_COOLDOWN_MS),
    };
  }

  /** The fight level a name is ranked and listed by: whichever of the two it is better at. */
  private fightLevel(sim: SimState): number {
    return Math.max(...Object.values(STYLE_SKILL).map((s) => skillLevel(sim, s, this.ctx)));
  }

  // ---- the screen -------------------------------------------------------------------------

  view(user: User, nowMs: number): RingGet {
    const mine = this.simOf(user.id);
    const rest = this.rest(user.id, nowMs);
    const led = this.ledger(user.id);
    const rows = this.db
      .prepare(
        `SELECT u.id, u.name, s.god, s.record, s.updated_at FROM saves s
         JOIN users u ON u.id = s.user_id
         WHERE s.updated_at >= ? AND s.user_id != ?`,
      )
      .all(nowMs - SEEN_WITHIN_MS, user.id) as {
      id: number;
      name: string;
      god: string | null;
      record: string;
      updated_at: number;
    }[];
    const names: RingName[] = [];
    for (const row of rows) {
      const sim = this.simOf(row.id);
      if (sim === null || !sim.combat.bouts.open) continue;
      names.push({
        name: row.name,
        god: row.god,
        level: this.fightLevel(sim),
        seenAgoMs: Math.max(0, nowMs - row.updated_at),
        bouts: sim.stats.bouts,
        taken: sim.stats.taken,
        restMs: this.rest(row.id, nowMs).called,
      });
    }
    names.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    return {
      in: mine !== null && mine.combat.bouts.open,
      restMs: rest.caller,
      owed: led.owed,
      names,
      bouts: this.boutsFor(user.id, nowMs),
    };
  }

  private boutsFor(userId: number, nowMs: number): BoutRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM bouts WHERE caller_id = ? OR called_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(userId, userId, CARD) as Record<string, string | number>[];
    return rows.map((r) => this.rowToBout(r, userId, nowMs));
  }

  private rowToBout(r: Record<string, string | number>, userId: number, nowMs: number): BoutRow {
    const winnerId = Number(r['winner_id']);
    return {
      id: Number(r['id']),
      caller: String(r['caller']),
      called: String(r['called']),
      callerFighter: JSON.parse(String(r['caller_fighter'])) as Fighter,
      calledFighter: JSON.parse(String(r['called_fighter'])) as Fighter,
      seed: Number(r['seed']),
      slot: String(r['slot']),
      prize: String(r['prize']),
      stake: String(r['stake']),
      winner: winnerId === Number(r['caller_id']) ? String(r['caller']) : String(r['called']),
      onPoints: Number(r['on_points']) === 1,
      agoMs: Math.max(0, nowMs - Number(r['created_at'])),
      yours: Number(r['caller_id']) === userId,
    };
  }

  /**
   * What a name in the ring is wearing, and what each piece would cost the caller to play for.
   * Body slots only, and only ones that can actually be lost — the same slots a death takes
   * from — so a reader learns nothing about a bank, a purse or a skill they could not already
   * read off a board.
   */
  card(user: User, name: string, nowMs: number): RingCard {
    const target = this.userByName(name);
    if (target === null) throw new BoutError(404, 'no such name on the hill');
    if (target.id === user.id) throw new BoutError(400, 'you cannot call yourself out');
    const theirs = this.simOf(target.id);
    if (theirs === null || !theirs.combat.bouts.open) {
      throw new BoutError(409, `${target.name} is not in the ring`);
    }
    const mine = this.simOf(user.id);
    if (mine === null) throw new BoutError(409, 'you have no save on the hill yet');
    const worn: RingWorn[] = [];
    for (const slot of LOSABLE_SLOTS) {
      const item = theirs.equipment[slot];
      if (item === null || !this.ctx.content.hasItem(item)) continue;
      const prize = this.ctx.content.item(item);
      const stakeId = mine.equipment[slot];
      const stake =
        stakeId !== null && this.ctx.content.hasItem(stakeId)
          ? this.ctx.content.item(stakeId)
          : null;
      const refusal =
        stake === null
          ? `you have nothing in the ${slot} slot to put up`
          : stake.value < prize.value
            ? `your ${stake.name} is not worth their ${prize.name}`
            : null;
      worn.push({
        slot,
        item,
        value: prize.value,
        stake: stakeId,
        stakeValue: stake?.value ?? 0,
        ok: refusal === null,
        refusal,
      });
    }
    return {
      name: target.name,
      fighter: fighterFrom(theirs, this.ctx, target.name),
      worn,
      restMs: this.rest(target.id, nowMs).called,
    };
  }

  private userByName(name: string): { id: number; name: string } | null {
    const row = this.db
      .prepare('SELECT id, name FROM users WHERE name_key = ?')
      .get(name.trim().toLowerCase()) as { id: number; name: string } | undefined;
    return row ?? null;
  }

  // ---- calling someone out ----------------------------------------------------------------

  /**
   * The whole bout in one transaction: both saves read, both fighters resolved, the seed drawn,
   * the fight run, the escrow pinned and both settlements written. `BEGIN IMMEDIATE` is what
   * stops two callers winning the same helm — but only because the escrow row is a write, so
   * the second call sees it. Reading an unchanging stored record proves nothing on its own.
   */
  call(user: User, name: string, item: string, nowMs: number): RingCalled {
    return transactionOn(this.db, () => {
      const target = this.userByName(name);
      if (target === null) throw new BoutError(404, 'no such name on the hill');
      if (target.id === user.id) throw new BoutError(400, 'you cannot call yourself out');

      const mine = this.simOf(user.id);
      if (mine === null) throw new BoutError(409, 'you have no save on the hill yet');
      if (!mine.combat.bouts.open) throw new BoutError(409, 'you have not stepped into the ring');
      const theirs = this.simOf(target.id);
      if (theirs === null || !theirs.combat.bouts.open) {
        throw new BoutError(409, `${target.name} is not in the ring`);
      }

      if (this.ledger(user.id).owed >= OWED_BARS_AT) {
        throw new BoutError(409, 'the ring wants what you already owe it first');
      }
      const rest = this.rest(user.id, nowMs);
      if (rest.caller > 0)
        throw new BoutError(429, `you may call again in ${minutes(rest.caller)}`);
      const theirRest = this.rest(target.id, nowMs).called;
      if (theirRest > 0) {
        throw new BoutError(429, `${target.name} has fought lately — ${minutes(theirRest)}`);
      }

      // What is played for, and what covers it. The slot is the prize's, both ways.
      const slot = LOSABLE_SLOTS.find((s) => theirs.equipment[s] === item);
      if (slot === undefined) throw new BoutError(409, `${target.name} is not wearing that`);
      if (!this.ctx.content.hasItem(item)) throw new BoutError(400, 'no such thing');
      const prize = this.ctx.content.item(item);
      const stakeId = mine.equipment[slot];
      if (stakeId === null || !this.ctx.content.hasItem(stakeId)) {
        throw new BoutError(409, `you have nothing in the ${slot} slot to put up`);
      }
      const stake = this.ctx.content.item(stakeId);
      if (stake.value < prize.value) {
        throw new BoutError(409, `your ${stake.name} is not worth their ${prize.name}`);
      }
      for (const [id, s] of [
        [user.id, slot],
        [target.id, slot],
      ] as const) {
        const open = this.db
          .prepare('SELECT bout_id FROM bout_escrow WHERE user_id = ? AND slot = ?')
          .get(id, s);
        if (open !== undefined) throw new BoutError(409, `that ${s} is already in a bout`);
      }

      const callerFighter = fighterFrom(mine, this.ctx, user.name);
      const calledFighter = fighterFrom(theirs, this.ctx, target.name);
      const seed = this.random(0xffffffff);
      const result = fightBout(callerFighter, calledFighter, seed);
      const winnerId = result.winner === 'caller' ? user.id : target.id;

      const boutId = Number(
        (
          this.db
            .prepare(
              `INSERT INTO bouts (caller_id, called_id, caller, called, caller_fighter,
                 called_fighter, seed, slot, prize, stake, winner_id, on_points, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            )
            .get(
              user.id,
              target.id,
              user.name,
              target.name,
              JSON.stringify(callerFighter),
              JSON.stringify(calledFighter),
              seed,
              slot,
              item,
              stakeId,
              winnerId,
              result.onPoints ? 1 : 0,
              nowMs,
            ) as { id: number }
        ).id,
      );

      // The winner takes the thing that was played for on their side; the loser gives up theirs.
      const [wonItem, lostItem] = result.winner === 'caller' ? [item, stakeId] : [stakeId, item];
      const winner = result.winner === 'caller' ? user : target;
      const loser = result.winner === 'caller' ? target : user;
      this.settlement(winner.id, boutId, true, loser.name, wonItem, slot, nowMs);
      this.settlement(loser.id, boutId, false, winner.name, lostItem, slot, nowMs);
      this.db
        .prepare('INSERT INTO bout_escrow (user_id, slot, bout_id) VALUES (?, ?, ?)')
        .run(loser.id, slot, boutId);

      const row = this.db.prepare('SELECT * FROM bouts WHERE id = ?').get(boutId) as Record<
        string,
        string | number
      >;
      return { bout: this.rowToBout(row, user.id, nowMs), result };
    });
  }

  private settlement(
    userId: number,
    boutId: number,
    won: boolean,
    opponent: string,
    item: string,
    slot: string,
    nowMs: number,
  ): void {
    const next =
      Number(
        (
          this.db
            .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM bout_settlements WHERE user_id = ?')
            .get(userId) as { n: number }
        ).n,
      ) + 1;
    this.db
      .prepare(
        `INSERT INTO bout_settlements (user_id, seq, bout_id, won, opponent, item, slot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, next, boutId, won ? 1 : 0, opponent, item, slot, nowMs);
  }

  // ---- collecting, on the save that is being written ---------------------------------------

  /**
   * Called from inside `writeSave`'s transaction with the record that is about to be stored.
   * Everything not yet acknowledged is handed back so the sim can apply it; the caller applies
   * `applyBoutSync` to the record itself, so the stored save and the answer never disagree.
   *
   * A settlement is only marked settled once the incoming record says it has taken it, which
   * is what makes a dropped answer harmless: the next save is told again. A save that lies
   * about the number keeps its helm — and a save that can lie could have written itself the
   * helm anyway, so there is nothing here worth defending against it.
   */
  collect(userId: number): BoutSync {
    const led = this.ledger(userId);
    const rows = this.db
      .prepare(
        `SELECT seq, won, opponent, item, slot FROM bout_settlements
         WHERE user_id = ? AND seq > ? ORDER BY seq`,
      )
      .all(userId, led.settled_through) as unknown as SettlementRow[];
    if (rows.length === 0) {
      const owed = led.owed;
      if (led.settled_through === 0 && owed === 0) return NO_BOUT_SYNC;
      return { settle: [], settledThrough: led.settled_through, owed };
    }
    // Applied exactly once. `writeSave` folds the answer into the very record it is about to
    // store, so advancing the mark here and storing the result are one step — which is what
    // stops a save reset to zero being served its whole history again, the way the wheel's
    // payouts are. The price is that an answer this tab drops is not repeated: the debit is in
    // the stored record, so a reload has it, but a tab that keeps playing has not. Paying a
    // spoil twice would mint items for anyone who pressed Reset; missing a debit costs one
    // thing that a save able to drop the answer could have written itself anyway.
    const settledThrough = rows[rows.length - 1]!.seq;
    this.db
      .prepare(
        `INSERT INTO bout_ledger (user_id, settled_through, owed) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET settled_through = excluded.settled_through`,
      )
      .run(userId, settledThrough, led.owed);
    this.db
      .prepare('UPDATE bout_settlements SET settled = 1 WHERE user_id = ? AND seq <= ?')
      .run(userId, settledThrough);
    // A settled loss releases the slot it had pinned.
    this.db
      .prepare(
        `DELETE FROM bout_escrow WHERE user_id = ? AND bout_id IN
           (SELECT bout_id FROM bout_settlements WHERE user_id = ? AND seq <= ? AND won = 0)`,
      )
      .run(userId, userId, settledThrough);
    const settle: Settlement[] = rows.map((r) => ({
      seq: r.seq,
      won: r.won === 1,
      opponent: r.opponent,
      item: r.item,
      slot: r.slot,
      owed: led.owed,
    }));
    return { settle, settledThrough, owed: led.owed };
  }

  /**
   * How many bouts this name has been in, taken and lost, counted off the register's own
   * settlements rather than read out of the save. Every settlement is minted here, so this is
   * the one account of a name's record that a save cannot write for itself — which is what the
   * ring board has to rank on, the same way the boards rank a standing the register computes.
   */
  tally(userId: number): { bouts: number; taken: number; lost: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS bouts,
                COALESCE(SUM(won), 0) AS taken,
                COALESCE(SUM(1 - won), 0) AS lost
         FROM bout_settlements WHERE user_id = ?`,
      )
      .get(userId) as { bouts: number; taken: number; lost: number };
    return { bouts: Number(row.bouts), taken: Number(row.taken), lost: Number(row.lost) };
  }

  /** The balance after a save has paid what it could; the register's number, not the save's. */
  setOwed(userId: number, owed: number): void {
    const led = this.ledger(userId);
    this.db
      .prepare(
        `INSERT INTO bout_ledger (user_id, settled_through, owed) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET owed = excluded.owed`,
      )
      .run(userId, led.settled_through, Math.max(0, Math.round(owed)));
  }
}

function minutes(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${String(m)} min`;
  return `${String(Math.ceil(m / 60))} h`;
}

/** The bout runs inside whatever transaction is open, or opens its own. */
function transactionOn<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
