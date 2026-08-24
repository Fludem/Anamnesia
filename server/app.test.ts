import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNewSave, type SaveRecord } from '../src/sim/save.ts';
import { fixtureContext } from '../src/sim/testing/fixture.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

const T0 = 1_700_000_000_000;
/** What a save is answered with by a name in no hall with nothing on the cart. */
const NO_HALL_SYNC = { id: null, rooms: {}, took: [], given: 0 };
const NO_WHEEL_SYNC = { took: [], paid: [], purse: 0, bought: 0 };
const NO_BOUT_SYNC = { settle: [], settledThrough: 0, owed: 0 };

/** One browser: keeps the session cookie between calls. */
class Client {
  cookie: string | null = null;
  constructor(private readonly base: string) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(this.base + path, init);
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null, set };
  }
  register(name: string, password = 'hunter2hunter2') {
    return this.call('POST', '/api/register', { name, password });
  }
  login(name: string, password = 'hunter2hunter2') {
    return this.call('POST', '/api/login', { name, password });
  }
  put(record: SaveRecord, expectedCounter: number) {
    return this.call('PUT', '/api/save', { record, expectedCounter });
  }
}

function save(writerId: string, sim: Partial<SaveRecord['sim']> = {}): SaveRecord {
  const base = createNewSave({ seed: 1, nowMs: T0, writerId });
  return { ...base, sim: { ...base.sim, ...sim } };
}

let server: Server;
let base: string;
let now = T0;
let staticDir: string;

beforeAll(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'anamnesia-static-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>hill</title>');
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  const db = openDatabase(':memory:');
  server = createServer(createApp({ db, now: () => now, staticDir, ctx: fixtureContext }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(staticDir, { recursive: true, force: true });
});

describe('names', () => {
  it('registers, logs in by cookie, and logs out', async () => {
    const c = new Client(base);
    const r = await c.register('Sisyphus');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ user: { name: 'Sisyphus', createdAt: T0 } });
    expect(r.set).toMatch(/^anamnesia_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect((await c.call('GET', '/api/me')).body).toMatchObject({ user: { name: 'Sisyphus' } });

    const out = await c.call('POST', '/api/logout');
    expect(out.body).toEqual({ user: null });
    expect(out.set).toMatch(/Max-Age=0/);
    expect((await c.call('GET', '/api/me')).body).toEqual({ user: null });

    expect((await c.login('Sisyphus', 'wrong password')).status).toBe(401);
    expect((await c.login('sisyphus')).status).toBe(200);
    expect((await c.call('GET', '/api/me')).body).toMatchObject({ user: { name: 'Sisyphus' } });
  });

  it('a name is taken whatever its case, and must be a hero name with a real password', async () => {
    const c = new Client(base);
    expect((await c.register('Old Hand')).status).toBe(201);
    const dupe = await new Client(base).register('old hand');
    expect(dupe.status).toBe(409);
    expect(dupe.body).toEqual({ error: 'That name is already on the hill.' });
    expect((await new Client(base).register('ab')).status).toBe(400);
    expect((await new Client(base).register('Fine Name', 'short')).status).toBe(400);
    expect((await new Client(base).call('POST', '/api/register', 'x')).status).toBe(400);
    const notJson = await new Client(base).call('POST', '/api/register', undefined, {
      'content-type': 'text/plain',
    });
    expect(notJson.status).toBe(415);
  });

  it('shuts the door after too many wrong passwords, and opens it later', async () => {
    await new Client(base).register('Guarded');
    const c = new Client(base);
    for (let i = 0; i < 10; i++) expect((await c.login('Guarded', 'not-the-one')).status).toBe(401);
    expect((await c.login('Guarded')).status).toBe(429);
    now += 16 * 60_000;
    expect((await c.login('Guarded')).status).toBe(200);
  });

  it('a session that is not used for three months ends', async () => {
    const c = new Client(base);
    await c.register('Forgetful');
    now += 91 * 24 * 3_600_000;
    expect((await c.call('GET', '/api/me')).body).toEqual({ user: null });
  });
});

describe('saves', () => {
  it('are guarded by the counter: a write lands only against the counter it read', async () => {
    const c = new Client(base);
    await c.register('Saver');
    expect((await c.call('GET', '/api/save')).body).toEqual({ record: null });

    const first = await c.put(save('tab-a'), 0);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      ok: true,
      saveCounter: 1,
      hall: NO_HALL_SYNC,
      wheel: NO_WHEEL_SYNC,
      bouts: NO_BOUT_SYNC,
    });
    const stored = (await c.call('GET', '/api/save')).body as { record: SaveRecord };
    expect(stored.record.saveCounter).toBe(1);
    expect(stored.record.writerId).toBe('tab-a');
    expect(stored.record.sim.player.name).toBe('Saver');

    // Another tab that still thinks the slot is empty is refused and told what is there.
    const stale = await c.put(save('tab-b'), 0);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, reason: 'stale', stored: { saveCounter: 1 } });

    expect((await c.put(save('tab-b'), 1)).body).toEqual({
      ok: true,
      saveCounter: 2,
      hall: NO_HALL_SYNC,
      wheel: NO_WHEEL_SYNC,
      bouts: NO_BOUT_SYNC,
    });
  });

  it('lets the last writer retry a write whose reply was lost', async () => {
    const c = new Client(base);
    await c.register('Flaky');
    await c.put(save('tab-a'), 0); // landed, but imagine the reply never arrived
    const retry = await c.put(save('tab-a', { tick: 5 }), 0);
    expect(retry.body).toEqual({
      ok: true,
      saveCounter: 2,
      hall: NO_HALL_SYNC,
      wheel: NO_WHEEL_SYNC,
      bouts: NO_BOUT_SYNC,
    });
    // Only the same writer: a different tab against the old counter is still stale.
    expect((await c.put(save('tab-c'), 1)).status).toBe(409);
    // And only one step behind.
    expect((await c.put(save('tab-a'), 0)).status).toBe(409);
  });

  it('needs a login and a save of this build', async () => {
    const anon = new Client(base);
    expect((await anon.call('GET', '/api/save')).status).toBe(401);
    expect((await anon.put(save('x'), 0)).status).toBe(401);
    const c = new Client(base);
    await c.register('Strict');
    const old = { ...save('x'), version: 1 } as unknown as SaveRecord;
    expect((await c.put(old, 0)).status).toBe(400);
    expect(
      (await c.call('PUT', '/api/save', { record: { nope: 1 }, expectedCounter: 0 })).status,
    ).toBe(400);
  });
});

describe('boards', () => {
  it('rank every name by its last save, ties to whoever came first, with the caller marked', async () => {
    const db = openDatabase(':memory:');
    const srv = createServer(createApp({ db, now: () => now, ctx: fixtureContext }));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${String((srv.address() as AddressInfo).port)}`;
    try {
      const a = new Client(url);
      const b = new Client(url);
      const z = new Client(url);
      await a.register('Alpha');
      await b.register('Beta');
      await z.register('Zeta');
      const xp = fixtureContext.xp.xpForLevel(20);
      await a.put(save('a', { skills: { mining: { xp } }, coins: 5 }), 0);
      now += 60_000;
      await b.put(save('b', { skills: { mining: { xp } }, coins: 50 }), 0);
      await z.put(save('z', { skills: { mining: { xp: xp * 2 } } }), 0);
      now += 30_000;

      const mining = (await b.call('GET', '/api/highscores/mining')).body as {
        players: number;
        rows: {
          rank: number;
          name: string;
          level: number | null;
          score: number;
          you: boolean;
          seenAgoMs: number;
        }[];
        standings: { board: string; rank: number; of: number }[];
      };
      expect(mining.players).toBe(3);
      expect(mining.rows.map((r) => [r.rank, r.name, r.level, r.you])).toEqual([
        [1, 'Zeta', fixtureContext.xp.levelForXp(xp * 2), false],
        [2, 'Alpha', 20, false],
        [3, 'Beta', 20, true],
      ]);
      expect(mining.rows.map((r) => r.seenAgoMs)).toEqual([30_000, 90_000, 30_000]);
      expect(mining.standings.find((s) => s.board === 'mining')).toMatchObject({ rank: 3, of: 3 });
      expect(mining.standings.find((s) => s.board === 'wealth')).toMatchObject({ rank: 1, of: 3 });
      expect(mining.standings.map((s) => s.board)).toEqual([
        'total',
        'wealth',
        'ring',
        ...fixtureContext.content.skills.map((s) => s.id),
      ]);

      const wealth = (await z.call('GET', '/api/highscores/wealth')).body as {
        rows: { name: string; level: number | null; score: number }[];
      };
      expect(wealth.rows.map((r) => [r.name, r.score, r.level])).toEqual([
        ['Beta', 50, null],
        ['Alpha', 5, null],
        ['Zeta', 0, null],
      ]);

      // Anyone may read the board; only a name has standings. A name with no save is not on it.
      const anon = await new Client(url).call('GET', '/api/highscores/total');
      expect(anon.status).toBe(200);
      expect(anon.body).toMatchObject({ players: 3, standings: [] });
      const newcomer = new Client(url);
      await newcomer.register('Watcher');
      expect((await newcomer.call('GET', '/api/highscores/total')).body).toMatchObject({
        players: 3,
        standings: [],
      });
      expect(
        (await anon.body, await new Client(url).call('GET', '/api/highscores/nope')).status,
      ).toBe(404);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('looks', () => {
  const look = {
    v: 1,
    bg: 3,
    shapes: [{ k: 'disc', x: 2, y: 2, w: 12, h: 12, c: 11, r: 0 }],
    paint: '.'.repeat(256),
  };

  it('a name paints its own look, the hill reads it by name, and it can take it down', async () => {
    const c = new Client(base);
    await c.register('Painter');
    expect((await c.call('PUT', '/api/look', { look })).status).toBe(200);

    const seen = await new Client(base).call('GET', '/api/looks?name=painter&name=Nobody%20Here');
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ names: { painter: look, 'Nobody Here': null }, halls: {} });

    expect((await c.call('PUT', '/api/look', { look: null })).status).toBe(200);
    const gone = await c.call('GET', '/api/looks?name=Painter');
    expect(gone.body).toEqual({ names: { Painter: null }, halls: {} });
  });

  it('refuses a look off the grid, a blank one counts as none, and it needs a login', async () => {
    const c = new Client(base);
    await c.register('Dauber');
    const off = { ...look, shapes: [{ ...look.shapes[0], x: 10 }] };
    expect((await c.call('PUT', '/api/look', { look: off })).status).toBe(400);
    const bad = { ...look, paint: '#'.repeat(256) };
    expect((await c.call('PUT', '/api/look', { look: bad })).status).toBe(400);
    const blank = { v: 1, bg: null, shapes: [], paint: '.'.repeat(256) };
    expect((await c.call('PUT', '/api/look', { look: blank })).status).toBe(200);
    expect((await c.call('GET', '/api/looks?name=Dauber')).body).toEqual({
      names: { Dauber: null },
      halls: {},
    });
    expect((await new Client(base).call('PUT', '/api/look', { look })).status).toBe(401);
    const many = Array.from({ length: 101 }, (_, i) => `name=n${String(i)}`).join('&');
    expect((await c.call('GET', `/api/looks?${many}`)).status).toBe(400);
  });

  it('only the founder paints the mark over a hall', async () => {
    const founder = new Client(base);
    await founder.register('Mark Founder');
    await founder.call('POST', '/api/hall', { name: 'The Marked Hall' });
    const other = new Client(base);
    await other.register('Mark Member');
    await other.call('POST', '/api/hall/request', { hall: 'The Marked Hall' });
    const door = (await founder.call('GET', '/api/hall')).body as { requests: { id: number }[] };
    await founder.call('POST', `/api/hall/petitions/${String(door.requests[0]!.id)}`, {
      accept: true,
    });

    const refused = await other.call('PUT', '/api/hall/look', { look });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'Only the founder paints the mark.' });
    expect((await founder.call('PUT', '/api/hall/look', { look })).status).toBe(200);
    const seen = await other.call('GET', '/api/looks?hall=the%20marked%20hall&hall=No%20Hall');
    expect(seen.body).toEqual({ names: {}, halls: { 'the marked hall': look, 'No Hall': null } });
    const nobody = new Client(base);
    await nobody.register('Hall-less');
    expect((await nobody.call('PUT', '/api/hall/look', { look })).status).toBe(403);
  });
});

describe('files', () => {
  it('serves the built game, with the page for any route and nothing outside the directory', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(await page.text()).toContain('hill');
    expect((await fetch(`${base}/some/route`)).status).toBe(200);
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
  });
});
