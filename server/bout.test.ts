import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RingCalled, RingCard, RingGet } from '../src/api/protocol.ts';
import type { BoutSync } from '../src/sim/bout.ts';
import { CALLED_COOLDOWN_MS, CALLER_COOLDOWN_MS } from '../src/sim/bout.ts';
import { createNewSave, type Equipment, type SaveRecord } from '../src/sim/save.ts';
import { fixtureContext } from '../src/sim/testing/fixture.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

const T0 = 1_700_000_000_000;

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
  /** What this name's last save said; the harness keeps it so a save is one line. */
  sim: { coins: number; equipment: Partial<Equipment>; open: boolean; settledThrough: number } = {
    coins: 0,
    equipment: {},
    open: true,
    settledThrough: 0,
  };
  bank: { item: string; qty: number }[] = [];
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

  /** Write the save as the harness currently describes it; returns the ring's answer. */
  async save() {
    this.played += PLAYED_STEP;
    const base = createNewSave({ seed: 1, nowMs: T0, writerId: 'tab' });
    const record: SaveRecord = {
      ...base,
      sim: {
        ...base.sim,
        tick: this.played,
        coins: this.sim.coins,
        bank: this.bank,
        equipment: { ...base.sim.equipment, ...this.sim.equipment },
        combat: { ...base.sim.combat, bouts: { open: this.sim.open } },
        bouts: { settledThrough: this.sim.settledThrough, owed: 0 },
      },
    };
    const r = await this.call('PUT', '/api/save', { record, expectedCounter: this.counter });
    const body = r.body as { ok: boolean; saveCounter: number; bouts: BoutSync };
    if (body.ok) this.counter = body.saveCounter;
    return { status: r.status, ...body };
  }
  /** Save, then acknowledge whatever came back, the way a living tab does. */
  async saveAndAck() {
    const first = await this.save();
    if (!first.ok) return first;
    // applyBoutSync applies the effect and moves settledThrough in one step, so a client can
    // never acknowledge without having paid. Adopt the stored record to model exactly that.
    await this.adopt();
    return first;
  }

  /** Take on the record the register stored, as applyAnswer leaves a living tab. */
  async adopt() {
    const stored = await this.stored();
    this.sim = {
      coins: stored.sim.coins,
      equipment: stored.sim.equipment,
      open: stored.sim.combat.bouts.open,
      settledThrough: stored.sim.bouts.settledThrough,
    };
    this.bank = stored.sim.bank;
  }
  stored() {
    return this.call('GET', '/api/save').then((r) => (r.body as { record: SaveRecord }).record);
  }
  ring() {
    return this.call('GET', '/api/ring').then((r) => r.body as RingGet);
  }
  card(name: string) {
    return this.call('GET', `/api/ring/card/${encodeURIComponent(name)}`);
  }
  callOut(name: string, item: string) {
    return this.call('POST', '/api/ring/call', { name, item });
  }
}

let server: Server;
let base: string;
let now = T0;
/** The seeds the register will draw, in order. */
const draws: number[] = [];

async function names<const N extends readonly string[]>(
  ...list: N
): Promise<{ [K in keyof N]: Client }> {
  const out: Client[] = [];
  for (const n of list) {
    now += 3_600_001;
    const c = new Client(base, n);
    expect((await c.register()).status).toBe(201);
    out.push(c);
  }
  return out as unknown as { [K in keyof N]: Client };
}

/** Move past every cooldown so the next call is judged on its own merits. */
const restEveryone = () => {
  now += CALLED_COOLDOWN_MS + 1;
};

beforeAll(async () => {
  const db = openDatabase(':memory:');
  server = createServer(
    createApp({ db, now: () => now, ctx: fixtureContext, random: () => draws.shift() ?? 1 }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('stepping into the ring', () => {
  it("a name that has not stepped in is on nobody's card and cannot call", async () => {
    const [a, b] = await names('Barred', 'Steady');
    a.sim = { ...a.sim, open: false, equipment: { head: 'helm' } };
    b.sim = { ...b.sim, open: true, equipment: { head: 'helm' } };
    await a.save();
    await b.save();
    // The barred name is not listed to the one who is in.
    expect((await b.ring()).names.map((n) => n.name)).not.toContain('Barred');
    // And cannot call anyone.
    const refused = await a.callOut('Steady', 'helm');
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toMatch(/stepped into the ring/);
  });

  it('a name in the ring is listed to another, with what it has done', async () => {
    const [a, b] = await names('Lister', 'Listed');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm' } };
      await c.save();
    }
    const seen = (await a.ring()).names.find((n) => n.name === 'Listed');
    expect(seen).toMatchObject({ name: 'Listed', bouts: 0, taken: 0, restMs: 0 });
    expect((await a.ring()).in).toBe(true);
  });
});

describe('what may be played for', () => {
  it('the card shows only what they are wearing, and what it would cost', async () => {
    const [a, b] = await names('Reader', 'Worn');
    a.sim = { ...a.sim, equipment: { head: 'helm', weapon: 'sword' } };
    b.sim = { ...b.sim, equipment: { head: 'helm', body: 'cuirass' } };
    await a.save();
    await b.save();
    const card = (await a.card('Worn')).body as RingCard;
    expect(card.worn.map((w) => w.slot).sort()).toEqual(['body', 'head']);
    const head = card.worn.find((w) => w.slot === 'head')!;
    expect(head).toMatchObject({ item: 'helm', stake: 'helm', ok: true, refusal: null });
    // Nothing in the body slot to put up against their cuirass.
    const body = card.worn.find((w) => w.slot === 'body')!;
    expect(body.ok).toBe(false);
    expect(body.refusal).toMatch(/nothing in the body slot/);
  });

  it('a stake must be worth the prize: a cheap helm cannot play for a dear one', async () => {
    const [a, b] = await names('Cheap', 'Dear');
    // The fixture's cuirass (60) is worth more than its helm (30); both sit in body/head, so
    // use two body-slot names by equipping the dear one on the called side.
    a.sim = { ...a.sim, equipment: { head: 'helm', body: 'cuirass' } };
    b.sim = { ...b.sim, equipment: { head: 'helm', body: 'cuirass' } };
    await a.save();
    await b.save();
    const card = (await a.card('Dear')).body as RingCard;
    // Like for like is fine.
    expect(card.worn.every((w) => w.ok)).toBe(true);
  });

  it('you cannot call yourself out', async () => {
    const [a] = await names('Alone');
    a.sim = { ...a.sim, equipment: { head: 'helm' } };
    await a.save();
    const r = await a.callOut('Alone', 'helm');
    expect(r.status).toBe(400);
  });

  it('you cannot play for something they are not wearing', async () => {
    const [a, b] = await names('Asker', 'Bare');
    a.sim = { ...a.sim, equipment: { head: 'helm' } };
    b.sim = { ...b.sim, equipment: { head: 'helm' } };
    await a.save();
    await b.save();
    const r = await a.callOut('Bare', 'cuirass');
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toMatch(/not wearing that/);
  });
});

describe('a bout', () => {
  it('is fought by the register, and both sides get the same seed to replay it', async () => {
    restEveryone();
    const [a, b] = await names('Fighter', 'Foe');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm', weapon: 'sword' } };
      await c.save();
    }
    draws.length = 0;
    draws.push(4242);
    const r = await a.callOut('Foe', 'helm');
    expect(r.status).toBe(200);
    const { bout, result } = r.body as RingCalled;
    expect(bout.seed).toBe(4242);
    expect(bout.prize).toBe('helm');
    expect(bout.stake).toBe('helm');
    expect(bout.caller).toBe('Fighter');
    expect(bout.called).toBe('Foe');
    expect([bout.caller, bout.called]).toContain(bout.winner);
    expect(result.swings.length).toBeGreaterThan(0);
    // The row carries both sides' resolved numbers, so the replay can never drift.
    expect(bout.callerFighter.attack).toBe(bout.calledFighter.attack);
  });

  it('the loser gives the thing up on their next save, and the winner takes it', async () => {
    restEveryone();
    const [a, b] = await names('Taker', 'Giver');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm', weapon: 'sword' } };
      await c.save();
    }
    const { bout } = (await a.callOut('Giver', 'helm')).body as RingCalled;
    const winner = bout.winner === 'Taker' ? a : b;
    const loser = bout.winner === 'Taker' ? b : a;

    await winner.saveAndAck();
    const won = await winner.stored();
    expect(won.sim.bank.find((s) => s.item === 'helm')).toEqual({ item: 'helm', qty: 1 });
    expect(won.sim.stats.taken).toBe(1);

    await loser.saveAndAck();
    const lost = await loser.stored();
    expect(lost.sim.equipment.head).toBe(null);
    expect(lost.sim.stats.lost).toBe(1);
  });

  it("neither side is ever made stale by the other's bout", async () => {
    restEveryone();
    const [a, b] = await names('Live', 'Other');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm' } };
      await c.save();
    }
    await a.callOut('Other', 'helm');
    // Both tabs carry on saving from the counter they already had: no 409, ever.
    expect((await a.save()).status).toBe(200);
    expect((await b.save()).status).toBe(200);
  });

  it('is applied exactly once, even to a save that never acknowledges it', async () => {
    restEveryone();
    const [a, b] = await names('Deaf', 'Loud');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm' } };
      await c.save();
    }
    const { bout } = (await a.callOut('Loud', 'helm')).body as RingCalled;
    const winner = bout.winner === 'Deaf' ? a : b;

    // The first save is answered; every save after it is answered with nothing more, and the
    // helm is in the bank once however many times the name writes.
    expect((await winner.save()).bouts.settle.length).toBe(1);
    await winner.adopt();
    for (let i = 0; i < 3; i++) expect((await winner.save()).bouts.settle.length).toBe(0);
    expect((await winner.stored()).sim.bank.filter((s) => s.item === 'helm')).toEqual([
      { item: 'helm', qty: 1 },
    ]);
  });

  it('a save reset to nothing cannot re-collect what it has already been paid', async () => {
    restEveryone();
    const [a, b] = await names('Resetter', 'Rival');
    for (const c of [a, b]) {
      c.sim = { ...c.sim, equipment: { head: 'helm' } };
      await c.save();
    }
    const { bout } = (await a.callOut('Rival', 'helm')).body as RingCalled;
    const winner = bout.winner === 'Resetter' ? a : b;
    await winner.saveAndAck();

    // The reset: settledThrough back to zero, as Settings → Reset writes it.
    winner.sim.settledThrough = 0;
    const answer = await winner.save();
    expect(answer.bouts.settle).toEqual([]);
    expect(answer.bouts.settledThrough).toBe(1);
  });
});

describe("the ring's clocks and locks", () => {
  it('a name cannot be called out twice in a row', async () => {
    restEveryone();
    const [a, b, c] = await names('First', 'Popular', 'Second');
    for (const x of [a, b, c]) {
      x.sim = { ...x.sim, equipment: { head: 'helm' } };
      await x.save();
    }
    expect((await a.callOut('Popular', 'helm')).status).toBe(200);
    const again = await c.callOut('Popular', 'helm');
    expect(again.status).toBe(429);
    expect((again.body as { error: string }).error).toMatch(/fought lately/);
  });

  it('a caller must wait between calls', async () => {
    restEveryone();
    const [a, b, c] = await names('Busy', 'One', 'Two');
    for (const x of [a, b, c]) {
      x.sim = { ...x.sim, equipment: { head: 'helm' } };
      await x.save();
    }
    expect((await a.callOut('One', 'helm')).status).toBe(200);
    // Their own clock bites before anything about the next target does.
    now += CALLER_COOLDOWN_MS / 2;
    const soon = await a.callOut('Two', 'helm');
    expect(soon.status).toBe(429);
    expect((soon.body as { error: string }).error).toMatch(/you may call again/);
    // Once it has run out, the caller's own clock is no longer what stands in the way.
    now += CALLER_COOLDOWN_MS;
    const later = await a.callOut('Two', 'helm');
    expect((later.body as { error?: string }).error ?? '').not.toMatch(/you may call again/);
  });

  it('a slot with an unsettled loss on it cannot be played for again', async () => {
    restEveryone();
    const [a, b, c] = await names('Pinner', 'Pinned', 'Third');
    for (const x of [a, b, c]) {
      x.sim = { ...x.sim, equipment: { head: 'helm' } };
      await x.save();
    }
    const { bout } = (await a.callOut('Pinned', 'helm')).body as RingCalled;
    const loser = bout.winner === 'Pinner' ? b : a;
    restEveryone();
    // The loser's head slot is pinned until their save settles it.
    const blocked = await c.callOut(loser.name, 'helm');
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: string }).error).toMatch(/already in a bout/);
    // Once they settle, it is free again.
    await loser.saveAndAck();
    loser.sim.equipment = { head: 'helm' };
    await loser.save();
    restEveryone();
    expect((await c.callOut(loser.name, 'helm')).status).toBe(200);
  });
});

describe('a debt that cannot be paid in kind', () => {
  it("costs twice the thing's worth in coin when it has been sold", async () => {
    restEveryone();
    const [a, b] = await names('Seller', 'Buyer');
    for (const x of [a, b]) {
      x.sim = { ...x.sim, equipment: { head: 'helm' }, coins: 10_000 };
      await x.save();
    }
    const { bout } = (await a.callOut('Buyer', 'helm')).body as RingCalled;
    const loser = bout.winner === 'Seller' ? b : a;
    // They take it off and sell it before the register can collect.
    loser.sim.equipment = {};
    await loser.saveAndAck();
    // The fixture helm is worth 30, so the ferryman's twice is 60.
    expect((await loser.stored()).sim.coins).toBe(9_940);
  });

  it('what cannot be paid stays owed, and an owing name is out of the ring', async () => {
    restEveryone();
    const [a, b, c] = await names('Broke', 'Rich', 'Bystander');
    for (const x of [a, b, c]) {
      x.sim = { ...x.sim, equipment: { head: 'helm' }, coins: 0 };
      await x.save();
    }
    const { bout } = (await a.callOut('Rich', 'helm')).body as RingCalled;
    const loser = bout.winner === 'Broke' ? b : a;
    loser.sim.equipment = {};
    loser.sim.coins = 0;
    await loser.saveAndAck();
    expect((await loser.ring()).owed).toBe(60);
    restEveryone();
    const refused = await loser.callOut('Bystander', 'helm');
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toMatch(/already owe/);
  });
});
