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

class Client {
  cookie: string | null = null;
  counter = 0;
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
  cashOut() {
    return this.call('POST', '/api/wheel/cash-out', {});
  }
  /** Save with these coins and this cart; returns the wheel's answer. */
  async save(coins: number, cart: BuyIn[] = [], paidThrough = 0, bought = cart.length) {
    const base = createNewSave({ seed: 1, nowMs: T0, writerId: 'tab' });
    const record: SaveRecord = {
      ...base,
      sim: { ...base.sim, coins, wheel: { cart, bought, paidThrough } },
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

describe('chips', () => {
  it('a buy-in on the cart is credited once, however many saves carry it', async () => {
    const [a] = await names('Alpha');
    const first = await a.save(900, [{ id: 1, coins: 100 }]);
    expect(first.wheel).toEqual({ took: [1], paid: [], purse: 100, bought: 1 });
    const again = await a.save(900, [{ id: 1, coins: 100 }]);
    expect(again.wheel).toEqual({ took: [1], paid: [], purse: 100, bought: 1 });
    const more = await a.save(850, [
      { id: 1, coins: 100 },
      { id: 2, coins: 50 },
    ]);
    expect(more.wheel).toEqual({ took: [1, 2], paid: [], purse: 150, bought: 2 });
    expect((await a.stored()).sim.wheel.cart).toHaveLength(2);
    expect((await a.wheel()).purse).toEqual({ coins: 150, staked: 0, returned: 0 });
  });

  it('the answer never lets the buy-in count fall behind the ledger', async () => {
    const [a] = await names('Behind');
    await a.save(0, [{ id: 3, coins: 10 }], 0, 3);
    const old = await a.save(0, [], 0, 0);
    expect(old.wheel.bought).toBe(3);
    expect((await a.stored()).sim.wheel.bought).toBe(3);
  });

  it('a cash-out is paid into the next save once, and stamped into the stored record', async () => {
    const [a] = await names('Cash');
    await a.save(0, [{ id: 1, coins: 250 }]);
    expect((await a.cashOut()).status).toBe(200);
    expect((await a.wheel()).purse?.coins).toBe(0);
    // The tab still says paidThrough 0: the payout is added to what it sent, and stamped.
    const w = await a.save(40, [{ id: 1, coins: 250 }], 0, 1);
    expect(w.wheel).toEqual({ took: [1], paid: [{ seq: 1, coins: 250 }], purse: 0, bought: 1 });
    const stored = await a.stored();
    expect(stored.sim.coins).toBe(290);
    expect(stored.sim.wheel.paidThrough).toBe(1);
    // A reply that went missing: the same save again is answered the same way, not doubled.
    const lost = await a.save(40, [{ id: 1, coins: 250 }], 0, 1);
    expect(lost.wheel.paid).toEqual([{ seq: 1, coins: 250 }]);
    expect((await a.stored()).sim.coins).toBe(290);
    // Once the tab has taken it, nothing more comes.
    const taken = await a.save(290, [], 1, 1);
    expect(taken.wheel.paid).toEqual([]);
    expect((await a.stored()).sim.coins).toBe(290);
    expect((await a.cashOut()).status).toBe(409);
  });

  it('a payout is numbered past what the save has taken, even when the ledger is behind', async () => {
    const [a] = await names('Restored');
    await a.save(0, [{ id: 1, coins: 30 }], 5, 1);
    await a.cashOut();
    const w = await a.save(0, [{ id: 1, coins: 30 }], 5, 1);
    expect(w.wheel.paid).toEqual([{ seq: 6, coins: 30 }]);
  });
});

describe('the table', () => {
  it('takes bets while the round is open, from the purse, and shows everyone at it', async () => {
    const [a, b] = await names('Ann', 'Bea');
    await a.save(0, [{ id: 1, coins: 1000 }]);
    await b.save(0, [{ id: 1, coins: 500 }]);
    const r = round();
    expect((await a.bet(r, 'red', 100)).status).toBe(200);
    expect((await a.bet(r, 'red', 50)).status).toBe(200);
    expect((await a.bet(r, 'straight:17', 10)).status).toBe(200);
    expect((await b.bet(r, 'black', 500)).status).toBe(200);
    const short = await b.bet(r, 'black', 1);
    expect(short.status).toBe(409);
    expect((short.body as { error: string }).error).toMatch(/not enough/);
    const view = await a.wheel();
    expect(view.round).toMatchObject({
      id: r,
      opensAt: now,
      closesAt: now + BETS_MS,
      pocket: null,
    });
    expect(view.purse).toEqual({ coins: 840, staked: 160, returned: 0 });
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

  it('refuses a bet after the close, on another round, or of a broken size', async () => {
    const [a] = await names('Late');
    await a.save(0, [{ id: 1, coins: 100 }]);
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
    expect((await a.wheel()).purse?.coins).toBe(99);
  });

  it('draws the pocket when the bets close and pays the winners into their purses', async () => {
    const [a, b] = await names('Win', 'Lose');
    await a.save(0, [{ id: 1, coins: 1000 }]);
    await b.save(0, [{ id: 1, coins: 1000 }]);
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
    expect(shown.purse).toEqual({ coins: 860 + 360 + 90, staked: 140, returned: 450 });
    expect((await b.wheel()).purse).toEqual({ coins: 750 + 400, staked: 250, returned: 400 });
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
  });

  it('the double zero beats every outside bet', async () => {
    const [a] = await names('Zero');
    await a.save(0, [{ id: 1, coins: 100 }]);
    const r = round();
    await a.bet(r, 'red', 10);
    await a.bet(r, 'black', 10);
    await a.bet(r, 'low', 10);
    await a.bet(r, 'straight:37', 10);
    draws.push(DOUBLE_ZERO);
    now += ROUND_MS;
    expect((await a.wheel()).purse).toEqual({ coins: 60 + 360, staked: 40, returned: 360 });
  });

  it('a round nobody looked at for hours is still drawn, and the strip is no longer than it needs to be', async () => {
    const [a] = await names('Away');
    await a.save(0, [{ id: 1, coins: 100 }]);
    await a.bet(round(), 'even', 100);
    draws.push(2);
    now += 5 * 3_600_000;
    const view = await a.wheel();
    expect(view.purse?.coins).toBe(200);
    expect(view.last).toHaveLength(HISTORY);
    expect(view.last.every((s) => s.players.length === 0)).toBe(true);
  });
});
