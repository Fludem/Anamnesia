import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HallGet, HallSummary } from '../src/api/protocol.ts';
import type { Gift, HallSync } from '../src/sim/hall.ts';
import { createNewSave, type SaveRecord } from '../src/sim/save.ts';
import { fixtureContext } from '../src/sim/testing/fixture.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { MAX_MEMBERS } from './hall.ts';

const T0 = 1_700_000_000_000;

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
  hall() {
    return this.call('GET', '/api/hall').then((r) => r.body as HallGet);
  }
  /** Save with these gifts on the cart; returns the hall's answer. */
  /** `given` defaults to the highest number on the cart, which is what a save really carries. */
  async save(
    gifts: Gift[] = [],
    given = gifts.reduce((n, g) => Math.max(n, g.id), 0),
    sim: Partial<SaveRecord['sim']> = {},
  ) {
    const base = createNewSave({ seed: 1, nowMs: T0, writerId: 'tab' });
    const record: SaveRecord = {
      ...base,
      sim: { ...base.sim, ...sim, hall: { id: null, rooms: {}, gifts, given } },
    };
    const r = await this.call('PUT', '/api/save', { record, expectedCounter: this.counter });
    const body = r.body as { ok: boolean; saveCounter: number; hall: HallSync };
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

/** Register every name, returning them in order; the tuple type lets tests index without `!`. */
async function names<const N extends readonly string[]>(
  ...list: N
): Promise<{ [K in keyof N]: Client }> {
  const out: Client[] = [];
  for (const n of list) {
    // The register allows ten new names an hour from one address; the hill is patient.
    now += 3_600_001;
    const c = new Client(base, n);
    expect((await c.register()).status).toBe(201);
    out.push(c);
  }
  return out as unknown as { [K in keyof N]: Client };
}

const gift = (id: number, room: string, item: string | null, qty: number, tier = 1): Gift => ({
  id,
  room,
  tier,
  item,
  qty,
});

beforeAll(async () => {
  const db = openDatabase(':memory:');
  server = createServer(createApp({ db, now: () => now, ctx: fixtureContext }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('the door', () => {
  it('a name founds a hall, invites another, and the invited accepts', async () => {
    const [a, b] = await names('Alpha', 'Beta');
    expect((await a.hall()).hall).toBeNull();
    const founded = await a.call('POST', '/api/hall', { name: 'The Quiet Hall' });
    expect(founded.status).toBe(201);
    expect((founded.body as HallGet).hall).toMatchObject({
      name: 'The Quiet Hall',
      founder: 'Alpha',
      members: [{ name: 'Alpha', founder: true, you: true, given: 0, seenAgoMs: null }],
    });
    expect((await a.call('POST', '/api/hall', { name: 'Another' })).status).toBe(409);
    expect((await b.call('POST', '/api/hall', { name: 'the quiet hall' })).body).toEqual({
      error: 'A hall by that name already stands.',
    });

    now += 60_000;
    expect((await a.call('POST', '/api/hall/invite', { name: 'beta' })).status).toBe(200);
    const waiting = await b.hall();
    expect(waiting.hall).toBeNull();
    expect(waiting.invites).toMatchObject([
      { kind: 'invite', hall: 'The Quiet Hall', name: 'Alpha', agoMs: 0 },
    ]);
    const id = waiting.invites[0]!.id;
    // Only the invited answers an invite.
    expect(
      (await a.call('POST', `/api/hall/petitions/${String(id)}`, { accept: true })).status,
    ).toBe(403);
    const joined = await b.call('POST', `/api/hall/petitions/${String(id)}`, { accept: true });
    expect(joined.status).toBe(200);
    expect((joined.body as HallGet).hall?.members.map((m) => [m.name, m.founder, m.you])).toEqual([
      ['Alpha', true, false],
      ['Beta', false, true],
    ]);
    expect((await b.hall()).invites).toEqual([]);
    // In a hall now: may not be invited elsewhere, may not found.
    expect((await a.call('POST', '/api/hall/invite', { name: 'Beta' })).body).toEqual({
      error: 'Beta already has a hall.',
    });
    expect((await a.call('POST', '/api/hall/invite', { name: 'Nobody Here' })).status).toBe(404);
  });

  it('a name asks at a door and the founder answers; an invite meeting a request is a join', async () => {
    const [f, g, h] = await names('Founder', 'Gamma', 'Hopeful');
    await f.call('POST', '/api/hall', { name: 'Stone House' });
    expect((await g.call('POST', '/api/hall/request', { hall: 'No Such' })).status).toBe(404);
    expect((await g.call('POST', '/api/hall/request', { hall: 'stone house' })).status).toBe(200);
    const outside = await g.hall();
    expect(outside.hall).toBeNull();
    expect(outside.requests).toMatchObject([
      { kind: 'request', hall: 'Stone House', name: 'Gamma' },
    ]);
    // The asker may take it back, but not let themself in.
    const own = outside.requests[0]!.id;
    expect(
      (await g.call('POST', `/api/hall/petitions/${String(own)}`, { accept: true })).status,
    ).toBe(403);
    expect(
      (await g.call('POST', `/api/hall/petitions/${String(own)}`, { accept: false })).status,
    ).toBe(200);
    expect((await g.hall()).requests).toEqual([]);
    await g.call('POST', '/api/hall/request', { hall: 'stone house' });
    const door = await f.hall();
    expect(door.requests).toMatchObject([{ kind: 'request', name: 'Gamma', hall: 'Stone House' }]);
    // Declined: gone from the door, Gamma still outside.
    const no = await f.call('POST', `/api/hall/petitions/${String(door.requests[0]!.id)}`, {
      accept: false,
    });
    expect((no.body as HallGet).requests).toEqual([]);
    expect((await g.hall()).hall).toBeNull();
    // Asked again and accepted.
    await g.call('POST', '/api/hall/request', { hall: 'Stone House' });
    const again = (await f.hall()).requests[0]!;
    const yes = await f.call('POST', `/api/hall/petitions/${String(again.id)}`, { accept: true });
    expect((yes.body as HallGet).hall?.members.map((m) => m.name)).toEqual(['Founder', 'Gamma']);
    // Hopeful asks; Gamma (a member, not the founder) invites: the two meet and Hopeful is in.
    await h.call('POST', '/api/hall/request', { hall: 'Stone House' });
    expect((await g.hall()).requests).toEqual([]); // only the founder sees the door
    await g.call('POST', '/api/hall/invite', { name: 'Hopeful' });
    expect((await h.hall()).hall?.members.map((m) => m.name)).toEqual([
      'Founder',
      'Gamma',
      'Hopeful',
    ]);
  });

  it('leaving hands the keys on, the last one out closes the hall, the founder may turn a name out', async () => {
    const [p, q, r] = await names('Prime', 'Quiet', 'Rest');
    await p.call('POST', '/api/hall', { name: 'The Last Hall' });
    for (const c of [q, r]) {
      await c.call('POST', '/api/hall/request', { hall: 'The Last Hall' });
      const id = (await p.hall()).requests[0]!.id;
      await p.call('POST', `/api/hall/petitions/${String(id)}`, { accept: true });
      now += 1000;
    }
    expect((await q.call('POST', '/api/hall/expel', { name: 'Rest' })).status).toBe(403);
    expect((await p.call('POST', '/api/hall/expel', { name: 'Prime' })).status).toBe(409);
    expect((await p.call('POST', '/api/hall/expel', { name: 'rest' })).status).toBe(200);
    expect((await r.hall()).hall).toBeNull();
    expect((await p.call('POST', '/api/hall/leave', {})).status).toBe(200);
    expect((await q.hall()).hall).toMatchObject({ founder: 'Quiet' });
    expect((await q.call('POST', '/api/hall/leave', {})).status).toBe(200);
    expect((await q.call('POST', '/api/hall/leave', {})).status).toBe(409);
    const halls = (await q.call('GET', '/api/halls')).body as HallSummary[];
    expect(halls.some((h) => h.name === 'The Last Hall')).toBe(false);
  });

  it('a hall holds twenty names', async () => {
    const [f] = await names('Full Founder');
    await f.call('POST', '/api/hall', { name: 'Crowded' });
    for (let i = 1; i < MAX_MEMBERS; i++) {
      const [c] = await names(`Crowd ${String(i)}`);
      await c.call('POST', '/api/hall/request', { hall: 'Crowded' });
      await f.call('POST', '/api/hall/invite', { name: c.name });
    }
    const [late] = await names('Too Late');
    expect((await late.call('POST', '/api/hall/request', { hall: 'Crowded' })).body).toEqual({
      error: 'That hall is full.',
    });
  });
});

describe('gifts', () => {
  it('a save with gifts raises the room; the answer says what was taken; the record keeps the cart', async () => {
    const [a, b] = await names('Giver', 'Helper');
    await a.call('POST', '/api/hall', { name: 'The Hearth Hall' });
    await a.call('POST', '/api/hall/invite', { name: 'Helper' });
    await b.call('POST', '/api/hall/request', { hall: 'The Hearth Hall' });
    const hallId = (await a.hall()).hall!.id;

    // The fixture hearth wants 10 logs for tier I.
    const first = await a.save([gift(1, 'hearth', 'log', 6)]);
    expect(first).toMatchObject({
      ok: true,
      hall: { id: hallId, rooms: {}, took: [{ id: 1, qty: 6 }], given: 1 },
    });
    const view = (await a.hall()).hall!;
    expect(view.rooms.find((r) => r.room === 'hearth')).toEqual({
      room: 'hearth',
      tier: 0,
      progress: [{ what: 'log', have: 6, need: 10 }],
    });
    expect(view.ledger).toMatchObject([{ name: 'Giver', room: 'hearth', what: 'log', qty: 6 }]);
    expect(view.members.find((m) => m.name === 'Giver')?.given).toBe(12);
    const stored = await a.stored();
    expect(stored.sim.hall).toEqual({
      id: hallId,
      rooms: {},
      gifts: [gift(1, 'hearth', 'log', 6)],
      given: 1,
    });

    // Helper gives more than is left: the hall takes 4 and the room stands.
    const second = await b.save([gift(1, 'hearth', 'log', 9)]);
    expect(second.hall).toEqual({
      id: hallId,
      rooms: { hearth: 1 },
      took: [{ id: 1, qty: 4 }],
      given: 1,
    });
    const raised = (await b.hall()).hall!;
    expect(raised.rooms.find((r) => r.room === 'hearth')).toEqual({
      room: 'hearth',
      tier: 1,
      progress: [
        { what: 'log', have: 0, need: 20 },
        { what: 'stone', have: 0, need: 5 },
        { what: '$gp', have: 0, need: 100 },
      ],
    });
    // Giver's next save still carries gift 1 (the client clears it itself): answered the same way.
    const again = await a.save([gift(1, 'hearth', 'log', 6)]);
    expect(again.hall.took).toEqual([{ id: 1, qty: 6 }]);
    expect((await a.hall()).hall!.members.find((m) => m.name === 'Giver')?.given).toBe(12);
    // A gift meant for tier I now that tier II is open comes back whole; coins count for tier II.
    const late = await a.save([gift(2, 'hearth', 'log', 3, 1), gift(3, 'hearth', null, 40, 2)]);
    expect(late.hall.took).toEqual([
      { id: 2, qty: 0 },
      { id: 3, qty: 40 },
    ]);
    expect(late.hall.given).toBe(3);
    // Nothing the tier wants, and a room that does not exist, are sent back.
    const odd = await a.save([gift(4, 'hearth', 'ore', 1, 2), gift(5, 'chapel', 'log', 1)]);
    expect(odd.hall.took).toEqual([
      { id: 4, qty: 0 },
      { id: 5, qty: 0 },
    ]);
  });

  it('a gift under a number the ledger has spent comes home whole, not answered as the old one', async () => {
    const [a] = await names('Wiper');
    await a.call('POST', '/api/hall', { name: 'The Wiped Hall' });
    // Six logs to the hearth, taken.
    expect((await a.save([gift(1, 'hearth', 'log', 6)])).hall.took).toEqual([{ id: 1, qty: 6 }]);
    // Settings → Reset: a fresh save that has never given anything. It is told where the count
    // really is, and nothing on the empty cart is taken.
    const wiped = await a.save([], 0);
    expect(wiped.hall).toMatchObject({ took: [], given: 1 });
    // The same gift again under the same number is a stranger to it now: it is sent back whole
    // rather than answered with what that number bought the first time, so the logs come home.
    const again = await a.save([gift(1, 'hearth', 'log', 6)], 1);
    expect(again.hall.took).toEqual([{ id: 1, qty: 0 }]);
    expect(again.hall.given).toBe(1);
    const view = (await a.hall()).hall!;
    expect(view.rooms.find((r) => r.room === 'hearth')?.progress).toEqual([
      { what: 'log', have: 6, need: 10 },
    ]);
    expect(view.members.find((m) => m.name === 'Wiper')?.given).toBe(12);
    // Numbered past the ledger, the very same gift is taken as it should be.
    const past = await a.save([gift(2, 'hearth', 'log', 6)], 2);
    expect(past.hall.took).toEqual([{ id: 2, qty: 4 }]);
  });

  it('a gift from a name with no hall comes back, and a number is never reused', async () => {
    const [solo] = await names('Solo');
    const out = await solo.save([gift(1, 'hearth', 'log', 5)]);
    expect(out.hall).toEqual({ id: null, rooms: {}, took: [{ id: 1, qty: 0 }], given: 1 });
    await solo.call('POST', '/api/hall', { name: 'Solo Hall' });
    // A reset-style save that says `given: 0` is told where the count really is.
    const reset = await solo.save([], 0);
    expect(reset.hall).toMatchObject({ rooms: {}, took: [], given: 1 });
    expect((await solo.stored()).sim.hall.given).toBe(1);
    // The old number 1 answers as it did (nothing taken), whatever it now claims to be.
    const reused = await solo.save([gift(1, 'hearth', 'log', 10)], 1);
    expect(reused.hall.took).toEqual([{ id: 1, qty: 0 }]);
    const fresh = await solo.save([gift(2, 'hearth', 'log', 10)], 2);
    expect(fresh.hall).toMatchObject({ rooms: { hearth: 1 }, took: [{ id: 2, qty: 10 }] });
  });

  it('a stale write touches no ledger row; leaving sends the cart back', async () => {
    const [m] = await names('Mover');
    await m.call('POST', '/api/hall', { name: 'Moving On' });
    m.counter = 5; // wrong on purpose
    const stale = await m.save([gift(1, 'hearth', 'log', 10)]);
    expect(stale.status).toBe(409);
    m.counter = 0;
    expect((await m.hall()).hall!.ledger).toEqual([]);
    await m.call('POST', '/api/hall/leave', {});
    const gone = await m.save([gift(1, 'hearth', 'log', 10)]);
    expect(gone.hall).toEqual({ id: null, rooms: {}, took: [{ id: 1, qty: 0 }], given: 1 });
  });

  it('lists every hall, most raised first', async () => {
    const halls = (await new Client(base, 'anon').call('GET', '/api/halls')).body as HallSummary[];
    expect(halls[0]).toMatchObject({ name: 'The Hearth Hall', members: 2, raised: 1, given: 60 });
    expect(halls.map((h) => h.name)).toContain('Solo Hall');
  });
});
