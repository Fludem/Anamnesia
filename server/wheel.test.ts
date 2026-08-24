import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WheelGet } from '../src/api/protocol.ts';
import { createNewSave, type SaveRecord } from '../src/sim/save.ts';
import { fixtureContext } from '../src/sim/testing/fixture.ts';
import {
  BETS_MS,
  DOUBLE_ZERO,
  ROUND_MS,
  type BuyIn,
  type Spot,
  type WheelSync,
} from '../src/sim/wheel.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { HISTORY } from './wheel.ts';

/** A moment at the very start of a round. */
const T0 = Math.ceil(1_700_000_000_000 / ROUND_MS) * ROUND_MS;

/**
 * Ticks a fabricated save has been played for. The register weighs what a save claims against
 * the ticks it took to claim it (sim/ceiling.ts), so a save that arrives out of nowhere with
 * coins already on it is refused like any other would be. Five more minutes each time is room
 * for anything these tests hand it.
 */
const PLAYED_STEP = 3_000;

class Client {
  cookie: string | null = null;
  counter = 0;
  played = 0;
  constructor(
    private readonly base: string,
    readonly name: string,
  ) {}

  async call(method: string, path: string, body?: unknown) {
    const init: RequestInit = {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(this.base + path, init);
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
  }
  register() {
    return this.call('POST', '/api/register', { name: this.name, password: 'hunter2hunter2' });
  }
  wheel() {
    return this.call('GET', '/api/wheel').then((r) => r.body as WheelGet);
  }
  bet(round: number, spot: Spot, stake: number) {
    return this.call('POST', '/api/wheel/bet', { round, spot, stake });
  }
  takeBack(round: number, spot?: Spot) {
    return this.call('POST', '/api/wheel/take-back', spot ? { round, spot } : { round });
  }
  /** Save with these coins and this cart; returns the wheel's answer. */
  async save(coins: number, cart: BuyIn[] = [], paidThrough = 0, bought = cart.length) {
    this.played += PLAYED_STEP;
    const base = createNewSave({ seed: 1, nowMs: T0, writerId: 'tab' });
    const record: SaveRecord = {
      ...base,
      sim: { ...base.sim, tick: this.played, coins, wheel: { cart, bought, paidThrough } },
    };
    const r = await this.call('PUT', '/api/save', { record, expectedCounter: this.counter });
    const body = r.body as { ok: boolean; saveCounter: number; wheel: WheelSync };
    if (body.ok) this.counter = body.saveCounter;
    return { status: r.status, ...body };
  }
  stored() {
    return this.call('GET', '/api/save').then((r) => (r.body as { record: SaveRecord }).record);
  }
}

let server: Server;
let base: string;
let now = T0;
/** The next pockets the wheel will draw, in order; 0 when the queue is empty. */
const draws: number[] = [];

async function names<const N extends readonly string[]>(
  ...list: N
): Promise<{ [K in keyof N]: Client }> {
  const out: Client[] = [];
  for (const n of list) {
    now += 3_600_001;
    now = Math.ceil(now / ROUND_MS) * ROUND_MS;
    const c = new Client(base, n);
    expect((await c.register()).status).toBe(201);
    out.push(c);
  }
  return out as unknown as { [K in keyof N]: Client };
}

const round = () => Math.floor(now / ROUND_MS);

beforeAll(async () => {
  const db = openDatabase(':memory:');
  server = createServer(
    createApp({ db, now: () => now, ctx: fixtureContext, random: () => draws.shift() ?? 0 }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('what the wheel owes', () => {
  it('an old cart is credited once and flushed home with the very same answer', async () => {
    const [a] = await names('Alpha');
    const first = await a.save(900, [{ id: 1, coins: 100 }]);
    expect(first.wheel).toEqual({ took: [1], paid: [{ seq: 1, coins: 100 }], purse: 0, bought: 1 });
    const stored = await a.stored();
    expect(stored.sim.coins).toBe(1000);
    expect(stored.sim.wheel.paidThrough).toBe(1);
    // A reply that went missing: the writer never saw the answer, so it writes again on the
    // counter it still holds. The same save is answered the same way, and not doubled.
    a.counter -= 1;
    const lost = await a.save(900, [{ id: 1, coins: 100 }], 0, 1);
    expect(lost.wheel).toEqual({ took: [1], paid: [{ seq: 1, coins: 100 }], purse: 0, bought: 1 });
    expect((await a.stored()).sim.coins).toBe(1000);
    // Once the tab has taken it, nothing more comes.
    const taken = await a.save(1000, [], 1, 1);
    expect(taken.wheel.paid).toEqual([]);
    expect((await a.stored()).sim.coins).toBe(1000);
  });

  it('a save that has forgotten what it was paid is not paid it all over again', async () => {
    const [a] = await names('Forgetful');
    const first = await a.save(0, [{ id: 1, coins: 500 }]);
    expect(first.wheel.paid).toEqual([{ seq: 1, coins: 500 }]);
    expect((await a.stored()).sim.coins).toBe(500);
    // Settings → Reset writes a fresh save on the counter the register holds, saying it has
    // never been paid anything. What it says is an acknowledgement, not a floor: the register
    // has its own record of what it served, and serves none of it again.
    const wiped = await a.save(0, [], 0, 0);
    expect(wiped.wheel.paid).toEqual([]);
    expect((await a.stored()).sim.coins).toBe(0);
    expect((await a.stored()).sim.wheel.paidThrough).toBe(1);
    // Nor on the next save, however long it goes on saying it.
    expect((await a.save(0, [], 0, 0)).wheel.paid).toEqual([]);
    expect((await a.stored()).sim.coins).toBe(0);
    // What the wheel owes after the reset is still paid, once.
    const [b] = await names('Forgetful Winner');
    await b.save(0, [{ id: 1, coins: 50 }]);
    const after = await b.save(0, [{ id: 2, coins: 70 }], 0, 2);
    expect(after.wheel.paid).toEqual([{ seq: 2, coins: 70 }]);
    expect((await b.stored()).sim.coins).toBe(70);
  });

  it('the answer never lets the buy-in count fall behind the ledger', async () => {
    const [a] = await names('Behind');
    await a.save(0, [{ id: 3, coins: 10 }], 0, 3);
    const old = await a.save(0, [], 0, 0);
    expect(old.wheel.bought).toBe(3);
    expect((await a.stored()).sim.wheel.bought).toBe(3);
  });

  it('a payout is numbered past what the save has taken, even when the ledger is behind', async () => {
    const [a] = await names('Restored');
    const w = await a.save(0, [{ id: 1, coins: 30 }], 5, 1);
    expect(w.wheel.paid).toEqual([{ seq: 6, coins: 30 }]);
  });
});

describe('the table', () => {
  it('takes bets while the round is open, straight from the purse, and shows everyone at it', async () => {
    const [a, b] = await names('Ann', 'Bea');
    const r = round();
    expect((await a.bet(r, 'red', 100)).status).toBe(200);
    expect((await a.bet(r, 'red', 50)).status).toBe(200);
    expect((await a.bet(r, 'straight:17', 10)).status).toBe(200);
    expect((await b.bet(r, 'black', 500)).status).toBe(200);
    const view = await a.wheel();
    expect(view.round).toMatchObject({
      id: r,
      opensAt: now,
      closesAt: now + BETS_MS,
      pocket: null,
    });
    expect(view.purse).toEqual({ coins: 0, staked: 160, returned: 0 });
    expect(view.table).toEqual([
      {
        name: 'Ann',
        bets: [
          { spot: 'red', stake: 150 },
          { spot: 'straight:17', stake: 10 },
        ],
      },
      { name: 'Bea', bets: [{ spot: 'black', stake: 500 }] },
    ]);
    expect((await b.wheel()).table).toEqual(view.table);
  });

  it('gives a bet back until the close — one spot, or every one at once', async () => {
    const [a] = await names('Sorry');
    const r = round();
    await a.bet(r, 'red', 100);
    await a.bet(r, 'straight:17', 40);
    expect((await a.takeBack(r, 'red')).status).toBe(200);
    let view = await a.wheel();
    expect(view.purse).toEqual({ coins: 100, staked: 40, returned: 0 });
    expect(view.table).toEqual([{ name: 'Sorry', bets: [{ spot: 'straight:17', stake: 40 }] }]);
    expect((await a.takeBack(r)).status).toBe(200);
    view = await a.wheel();
    expect(view.purse).toEqual({ coins: 140, staked: 0, returned: 0 });
    expect(view.table).toEqual([]);
    const bare = await a.takeBack(r);
    expect(bare.status).toBe(409);
    expect((bare.body as { error: string }).error).toMatch(/nothing/);
    // What was taken back comes home with the next save.
    const w = await a.save(0);
    expect(w.wheel.paid).toEqual([{ seq: 1, coins: 140 }]);
    // After the close, nothing comes back.
    await a.bet(r, 'odd', 10);
    now += BETS_MS;
    const closed = await a.takeBack(r);
    expect(closed.status).toBe(409);
    expect((closed.body as { error: string }).error).toMatch(/closed/);
    now += ROUND_MS - BETS_MS;
  });

  it('refuses a bet after the close, on another round, or of a broken size', async () => {
    const [a] = await names('Late');
    const r = round();
    now += BETS_MS - 1;
    expect((await a.bet(r, 'odd', 1)).status).toBe(200);
    now += 1;
    const closed = await a.bet(r, 'odd', 1);
    expect(closed.status).toBe(409);
    expect((closed.body as { error: string }).error).toMatch(/closed/);
    expect((await a.bet(r + 1, 'odd', 1)).status).toBe(409);
    expect((await a.bet(r, 'green', 1)).status).toBe(400);
    expect((await a.bet(r, 'odd', 0)).status).toBe(400);
    expect((await a.wheel()).purse).toMatchObject({ staked: 1 });
  });

  it('draws the pocket when the bets close and sets the winnings on their way home', async () => {
    const [a, b] = await names('Win', 'Lose');
    const r = round();
    await a.bet(r, 'straight:17', 10);
    await a.bet(r, 'red', 100);
    await a.bet(r, 'dozen:2', 30);
    await b.bet(r, 'black', 200);
    await b.bet(r, 'column:1', 50);
    draws.push(17);
    now += BETS_MS;
    const shown = await a.wheel();
    expect(shown.round.pocket).toBe(17);
    // 17 is black and in the second dozen: the number and the dozen pay, the red does not.
    expect(shown.purse).toEqual({ coins: 360 + 90, staked: 140, returned: 450 });
    expect((await b.wheel()).purse).toEqual({ coins: 400, staked: 250, returned: 400 });
    now += ROUND_MS - BETS_MS;
    const next = await a.wheel();
    expect(next.round.id).toBe(r + 1);
    expect(next.round.pocket).toBeNull();
    expect(next.last[0]).toEqual({
      id: r,
      pocket: 17,
      players: [
        { name: 'Win', staked: 140, returned: 450 },
        { name: 'Lose', staked: 250, returned: 400 },
      ],
    });
    // The winnings become a payout the moment the next save is written.
    const w = await a.save(1000);
    expect(w.wheel.paid).toEqual([{ seq: 1, coins: 450 }]);
    expect((await a.stored()).sim.coins).toBe(1450);
  });

  it('the double zero beats every outside bet', async () => {
    const [a] = await names('Zero');
    const r = round();
    await a.bet(r, 'red', 10);
    await a.bet(r, 'black', 10);
    await a.bet(r, 'low', 10);
    await a.bet(r, 'straight:37', 10);
    draws.push(DOUBLE_ZERO);
    now += ROUND_MS;
    expect((await a.wheel()).purse).toEqual({ coins: 360, staked: 40, returned: 360 });
  });

  it('a round nobody looked at for hours is still drawn, and the strip is no longer than it needs to be', async () => {
    const [a] = await names('Away');
    await a.bet(round(), 'even', 100);
    draws.push(2);
    now += 5 * 3_600_000;
    const view = await a.wheel();
    expect(view.purse?.coins).toBe(200);
    expect(view.last).toHaveLength(HISTORY);
    expect(view.last.every((s) => s.players.length === 0)).toBe(true);
  });
});
