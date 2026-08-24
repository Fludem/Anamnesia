/**
 * The wheel: one table for the whole hill, turned by the register's clock. A round is thirty
 * seconds — bets until twenty-four, then the pocket — and the pocket is drawn here, the moment
 * the bets close, with the process's own randomness, never the sim's. Nothing runs on a timer:
 * every look at the table settles whatever has closed first, so a round a bet was placed on is
 * always drawn, however long ago, and a process that was down for it draws it on waking.
 *
 * A bet is staked straight from the purse: the register records it here and the sim takes the
 * coins out of the save (trusted, like everything the save says). Until the bets close a name
 * may take a bet back. What the wheel owes a name — winnings, take-backs, and whatever an old
 * save's cart still carries in — sits in `wheel_purses.coins` only until that name's next save,
 * when `applyCart` turns it into a numbered payout the save brings home (see src/sim/wheel.ts
 * for the other half). `staked`/`returned` on the same row are the ledger the screen shows.
 * SQL for the table lives here and nowhere else.
 */
import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { User, WheelGet, WheelSpin } from '../src/api/protocol.ts';
import {
  POCKETS,
  payout,
  roundAt,
  type BuyIn,
  type Spot,
  type WheelSync,
} from '../src/sim/wheel.ts';
import { transaction } from './db.ts';

/** Spins the table remembers, and answers with. */
export const HISTORY = 12;
/** Distinct spots one name may cover in a round. */
export const MAX_SPOTS = 40;
/** Stakes are integers the register can add without losing precision. */
export const MAX_STAKE = 1_000_000_000_000;

export class WheelError extends Error {
  override readonly name = 'WheelError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface PurseRow {
  coins: number;
  staked: number;
  returned: number;
}

export class Wheel {
  constructor(
    private readonly db: DatabaseSync,
    /** A uniform integer in [0, n); the process's own by default, fixed in tests. */
    private readonly random: (n: number) => number = randomInt,
  ) {}

  // ---- chips ------------------------------------------------------------------------------

  purseOf(userId: number): PurseRow | null {
    const row = this.db
      .prepare('SELECT coins, staked, returned FROM wheel_purses WHERE user_id = ?')
      .get(userId) as PurseRow | undefined;
    return row ?? null;
  }

  /**
   * Settle a save with the table, inside the save's own transaction: each buy-in an old cart
   * still carries is credited once, whatever the wheel owes becomes a numbered payout, every
   * payout the save has not taken is answered again, and the answer carries the buy-in count
   * so a save cannot fall behind the ledger. Settlement runs first, so a round that closed
   * since the last look pays its winners into this very answer.
   */
  applyCart(userId: number, cart: readonly BuyIn[], paidThrough: number, nowMs: number): WheelSync {
    this.settle(nowMs);
    const took: number[] = [];
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO wheel_buyins (user_id, buyin_id, coins, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const b of [...cart].sort((a, c) => a.id - c.id)) {
      const r = insert.run(userId, b.id, b.coins, nowMs);
      if (r.changes > 0) this.credit(userId, b.coins, 0);
      took.push(b.id);
    }
    this.flush(userId, paidThrough, nowMs);
    const paid = this.db
      .prepare('SELECT seq, coins FROM wheel_payouts WHERE user_id = ? AND seq > ? ORDER BY seq')
      .all(userId, paidThrough) as { seq: number; coins: number }[];
    const max = (
      this.db
        .prepare('SELECT COALESCE(MAX(buyin_id), 0) AS n FROM wheel_buyins WHERE user_id = ?')
        .get(userId) as { n: number }
    ).n;
    return { took, paid, purse: this.purseOf(userId)?.coins ?? 0, bought: max };
  }

  /**
   * Whatever the wheel owes becomes a payout for the save being written; the credit is left
   * empty. The payout is numbered past both the ledger and `paidThrough` of the stored save, so
   * a ledger restored from an older backup can never hand out a number the save has already
   * taken.
   */
  private flush(userId: number, paidThrough: number, nowMs: number): void {
    const purse = this.purseOf(userId);
    if (purse === null || purse.coins <= 0) return;
    const known = (
      this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM wheel_payouts WHERE user_id = ?')
        .get(userId) as { n: number }
    ).n;
    const seq = Math.max(known, paidThrough) + 1;
    this.db
      .prepare('INSERT INTO wheel_payouts (user_id, seq, coins, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, seq, purse.coins, nowMs);
    this.db.prepare('UPDATE wheel_purses SET coins = 0 WHERE user_id = ?').run(userId);
  }

  /**
   * Take back this round's bets — all of them, or one spot's — while its bets are still open.
   * The coins join what the wheel owes and come home with the next save; the screen asks for
   * one straight away. `staked` is unwound too: a bet taken back never rode a spin.
   */
  takeBack(user: User, round: number, spot: Spot | null, nowMs: number): void {
    transaction(this.db, () => {
      this.settle(nowMs);
      const r = roundAt(nowMs);
      if (round !== r.id || nowMs >= r.closesAt) throw new WheelError(409, 'bets are closed');
      const where = spot === null ? '' : ' AND spot = ?';
      const args = spot === null ? [r.id, user.id] : [r.id, user.id, spot];
      const sum = (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(stake), 0) AS n FROM wheel_bets
             WHERE round_id = ? AND user_id = ?${where}`,
          )
          .get(...args) as { n: number }
      ).n;
      if (sum <= 0) throw new WheelError(409, 'nothing to take back');
      this.db
        .prepare(`DELETE FROM wheel_bets WHERE round_id = ? AND user_id = ?${where}`)
        .run(...args);
      this.db
        .prepare('UPDATE wheel_purses SET coins = coins + ?, staked = staked - ? WHERE user_id = ?')
        .run(sum, sum, user.id);
    });
  }

  private credit(userId: number, coins: number, returned: number): void {
    this.db
      .prepare(
        `INSERT INTO wheel_purses (user_id, coins, staked, returned) VALUES (?, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins,
           returned = returned + excluded.returned`,
      )
      .run(userId, coins, returned);
  }

  // ---- rounds -----------------------------------------------------------------------------

  /** The newest round whose bets have closed: this one once its bets shut, else the last. */
  private closedUpTo(nowMs: number): number {
    const r = roundAt(nowMs);
    return nowMs >= r.closesAt ? r.id : r.id - 1;
  }

  /**
   * Draw the pocket of every round whose bets have closed and pay its bets. Cheap when there
   * is nothing to do; runs inside every bet, take-back, save and look at the table.
   */
  settle(nowMs: number): void {
    const due = this.db
      .prepare('SELECT id FROM wheel_rounds WHERE pocket IS NULL AND id <= ? ORDER BY id')
      .all(this.closedUpTo(nowMs)) as { id: number }[];
    for (const { id } of due) this.spin(id, nowMs);
  }

  private spin(roundId: number, nowMs: number): void {
    const pocket = this.random(POCKETS);
    const bets = this.db
      .prepare('SELECT user_id, spot, stake FROM wheel_bets WHERE round_id = ?')
      .all(roundId) as { user_id: number; spot: Spot; stake: number }[];
    const stamp = this.db.prepare(
      'UPDATE wheel_bets SET won = ? WHERE round_id = ? AND user_id = ? AND spot = ?',
    );
    for (const b of bets) {
      const won = payout(b.stake, b.spot, pocket);
      stamp.run(won, roundId, b.user_id, b.spot);
      if (won > 0) this.credit(b.user_id, won, won);
    }
    this.db
      .prepare('UPDATE wheel_rounds SET pocket = ?, settled_at = ? WHERE id = ?')
      .run(pocket, nowMs, roundId);
  }

  /**
   * Make sure the last `HISTORY` closed rounds exist and have turned, so the strip has something
   * on it even when nobody bet — and only those, so a quiet night is not drawn round by round.
   */
  private backfill(nowMs: number): void {
    const upTo = this.closedUpTo(nowMs);
    const insert = this.db.prepare('INSERT OR IGNORE INTO wheel_rounds (id) VALUES (?)');
    for (let id = Math.max(0, upTo - HISTORY + 1); id <= upTo; id++) insert.run(id);
    this.settle(nowMs);
  }

  /**
   * Put `stake` on `spot` for the round that is open now, straight from the purse — the sim
   * takes the coins out of the save once the register says yes, and is trusted to, the way it
   * is about the save itself. Refused when the round named is not this one or its bets have
   * closed, or when too many spots are covered.
   */
  bet(user: User, round: number, spot: Spot, stake: number, nowMs: number): void {
    if (!Number.isInteger(stake) || stake < 1 || stake > MAX_STAKE)
      throw new WheelError(400, 'a stake is a whole number of gp');
    transaction(this.db, () => {
      this.settle(nowMs);
      const r = roundAt(nowMs);
      if (round !== r.id || nowMs >= r.closesAt) throw new WheelError(409, 'bets are closed');
      const spots = (
        this.db
          .prepare(
            'SELECT COUNT(*) AS n FROM wheel_bets WHERE round_id = ? AND user_id = ? AND spot != ?',
          )
          .get(r.id, user.id, spot) as { n: number }
      ).n;
      if (spots >= MAX_SPOTS) throw new WheelError(409, 'that is enough of the table for one name');
      this.db
        .prepare(
          `INSERT INTO wheel_purses (user_id, coins, staked, returned) VALUES (?, 0, ?, 0)
           ON CONFLICT(user_id) DO UPDATE SET staked = staked + excluded.staked`,
        )
        .run(user.id, stake);
      this.db.prepare('INSERT OR IGNORE INTO wheel_rounds (id) VALUES (?)').run(r.id);
      this.db
        .prepare(
          `INSERT INTO wheel_bets (round_id, user_id, spot, stake) VALUES (?, ?, ?, ?)
           ON CONFLICT(round_id, user_id, spot) DO UPDATE SET stake = stake + excluded.stake`,
        )
        .run(r.id, user.id, spot, stake);
    });
  }

  // ---- the view ---------------------------------------------------------------------------

  view(userId: number, nowMs: number): WheelGet {
    return transaction(this.db, () => this.look(userId, nowMs));
  }

  private look(userId: number, nowMs: number): WheelGet {
    this.backfill(nowMs);
    const at = roundAt(nowMs);
    const drawn = this.db.prepare('SELECT pocket FROM wheel_rounds WHERE id = ?').get(at.id) as
      { pocket: number | null } | undefined;
    const round = { ...at, pocket: drawn?.pocket ?? null };
    const rows = this.db
      .prepare(
        `SELECT u.name, b.spot, b.stake FROM wheel_bets b JOIN users u ON u.id = b.user_id
         WHERE b.round_id = ? ORDER BY u.id, b.rowid`,
      )
      .all(round.id) as { name: string; spot: Spot; stake: number }[];
    const table = new Map<string, { spot: Spot; stake: number }[]>();
    for (const r of rows) {
      const bets = table.get(r.name) ?? [];
      bets.push({ spot: r.spot, stake: r.stake });
      table.set(r.name, bets);
    }
    const spins = this.db
      .prepare(
        `SELECT id, pocket FROM wheel_rounds WHERE pocket IS NOT NULL AND id < ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(round.id, HISTORY) as { id: number; pocket: number }[];
    const players = this.db.prepare(
      `SELECT u.name, SUM(b.stake) AS staked, SUM(COALESCE(b.won, 0)) AS returned
       FROM wheel_bets b JOIN users u ON u.id = b.user_id WHERE b.round_id = ?
       GROUP BY u.id ORDER BY returned DESC, staked DESC`,
    );
    const last: WheelSpin[] = spins.map((s) => ({
      id: s.id,
      pocket: s.pocket,
      players: players.all(s.id) as { name: string; staked: number; returned: number }[],
    }));
    const purse = this.purseOf(userId);
    return {
      now: nowMs,
      round,
      purse,
      table: [...table].map(([name, bets]) => ({ name, bets })),
      last,
    };
  }
}
