import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatOverview, ChatPoll, ChatThread, Talk } from '../src/api/protocol.ts';
import { fixtureContext } from '../src/sim/testing/fixture.ts';
import { createApp } from './app.ts';
import { SAY_LIMIT } from './chat.ts';
import { openDatabase } from './db.ts';

const T0 = 1_700_000_000_000;
/** Polls in this file are held open this long at most. */
const WAIT_MS = 120;
const FIRE: Talk = { kind: 'room', room: 'fire' };
const WHEEL: Talk = { kind: 'room', room: 'wheel' };
const to = (name: string): Talk => ({ kind: 'name', name });

class Client {
  cookie: string | null = null;
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
  say(talk: Talk, body: string) {
    return this.call('POST', '/api/chat', { talk, body });
  }
  overview() {
    return this.call('GET', '/api/chat').then((r) => r.body as ChatOverview);
  }
  fire() {
    return this.overview().then((o) => o.rooms.find((r) => r.room === 'fire')!);
  }
  thread(name: string) {
    return this.call('GET', `/api/chat/with/${encodeURIComponent(name)}`);
  }
  poll(after: number) {
    return this.call('GET', `/api/chat/poll?after=${String(after)}`).then(
      (r) => r.body as ChatPoll,
    );
  }
  read(talk: Talk, id: number) {
    return this.call('POST', '/api/chat/read', { talk, id });
  }
  block(name: string, blocked: boolean) {
    return this.call('POST', '/api/chat/block', { name, blocked });
  }
}

let server: Server;
let base: string;
let now = T0;

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

const said = (m: ChatMessage) => [m.from, m.room, m.to, m.body];

beforeAll(async () => {
  const db = openDatabase(':memory:');
  server = createServer(
    createApp({ db, now: () => now, ctx: fixtureContext, pollWaitMs: WAIT_MS }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('the fire', () => {
  it('a word said in a room is heard by everyone there, oldest first, and counted until read', async () => {
    const [a, b] = await names('Ash', 'Birch');
    const first = await a.say(FIRE, '  Evening.  ');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      message: { from: 'Ash', room: 'fire', to: null, body: 'Evening.', atMs: now },
    });
    now += 1000;
    await b.say(FIRE, 'Evening');
    await b.say(WHEEL, 'Place your bets');
    const seen = await a.overview();
    const fire = seen.rooms.find((r) => r.room === 'fire')!;
    expect(fire.messages.map(said)).toEqual([
      ['Ash', 'fire', null, 'Evening.'],
      ['Birch', 'fire', null, 'Evening'],
    ]);
    const wheel = seen.rooms.find((r) => r.room === 'wheel')!;
    expect(wheel.messages.map(said)).toEqual([['Birch', 'wheel', null, 'Place your bets']]);
    expect(seen.latest).toBe(wheel.messages[0]!.id);
    expect(seen.names).toEqual([]);
    // Each room counts its own; a name's own words are not unread to it.
    expect(fire.unread).toBe(1);
    expect(wheel.unread).toBe(1);
    expect((await b.fire()).unread).toBe(1);
    await b.read(FIRE, seen.latest);
    expect((await b.fire()).unread).toBe(0);
    // Reading never moves back.
    await b.read(FIRE, 0);
    expect((await b.fire()).unread).toBe(0);
  });

  it('cleans what is said and refuses nothing, too much, and too many', async () => {
    const [c] = await names('Cedar');
    expect((await c.say(FIRE, '   ')).status).toBe(400);
    expect((await c.say(FIRE, 'x'.repeat(501))).status).toBe(400);
    const attic = { talk: { kind: 'room', room: 'attic' }, body: 'hm' };
    expect((await c.call('POST', '/api/chat', attic)).status).toBe(400);
    const odd = await c.say(FIRE, 'one two\r\n\r\n\r\n\r\nthree​  ');
    expect((odd.body as { message: ChatMessage }).message.body).toBe('one two\n\nthree');
    for (let i = 1; i < SAY_LIMIT.max; i++) expect((await c.say(FIRE, 'again')).status).toBe(201);
    const enough = await c.say(FIRE, 'once more');
    expect(enough.status).toBe(429);
    expect(enough.body).toEqual({ error: 'You have said enough for a minute.' });
    now += SAY_LIMIT.windowMs + 1;
    expect((await c.say(FIRE, 'now then')).status).toBe(201);
  });

  it('needs a name', async () => {
    const anon = new Client(base, 'nobody');
    expect((await anon.call('GET', '/api/chat')).status).toBe(401);
    expect((await anon.say(FIRE, 'hello?')).status).toBe(401);
    expect((await anon.call('GET', '/api/chat/poll?after=0')).status).toBe(401);
  });
});

describe('a word between two names', () => {
  it('reaches only them, lists them to each other, and counts what was not read', async () => {
    const [d, e, f] = await names('Dusk', 'Elm', 'Fen');
    expect((await d.say(to('elm'), 'A word?')).status).toBe(201);
    now += 1000;
    expect((await e.say(to('Dusk'), 'Go on.')).status).toBe(201);
    now += 1000;
    expect((await d.say(to('Elm'), 'Later, then.')).status).toBe(201);

    const elmSees = await e.overview();
    expect(elmSees.names).toHaveLength(1);
    expect(elmSees.names[0]).toMatchObject({ name: 'Dusk', unread: 2, blocked: false });
    expect(said(elmSees.names[0]!.last)).toEqual(['Dusk', null, 'Elm', 'Later, then.']);
    expect((await d.overview()).names[0]).toMatchObject({ name: 'Elm', unread: 1 });
    // Fen hears none of it, and the rooms do not either.
    const fenSees = await f.overview();
    expect(fenSees.names).toEqual([]);
    expect(fenSees.rooms.flatMap((r) => r.messages).some((m) => m.to !== null)).toBe(false);
    expect((await f.poll(0)).messages.some((m) => m.to !== null)).toBe(false);

    // Opening the talk reads it.
    const thread = await e.thread('dusk');
    expect(thread.status).toBe(200);
    expect((thread.body as ChatThread).messages.map(said)).toEqual([
      ['Dusk', null, 'Elm', 'A word?'],
      ['Elm', null, 'Dusk', 'Go on.'],
      ['Dusk', null, 'Elm', 'Later, then.'],
    ]);
    expect((thread.body as ChatThread).name).toBe('Dusk');
    expect((await e.overview()).names[0]).toMatchObject({ unread: 0 });

    expect((await d.say(to('Nobody Here'), 'hello?')).status).toBe(404);
    expect((await d.say(to('Dusk'), 'hello me')).status).toBe(400);
    expect((await d.thread('Nobody Here')).status).toBe(404);
    expect((await d.thread('Dusk')).status).toBe(400);
    expect((await d.read(to('Nobody Here'), 1)).status).toBe(404);
  });

  it('a name turned away from goes unheard, cannot answer, and can be turned back to', async () => {
    const [g, h] = await names('Gorse', 'Heath');
    await h.say(FIRE, 'Heath was here');
    await h.say(to('Gorse'), 'Oi');
    expect((await g.block('heath', true)).status).toBe(200);
    const sees = await g.overview();
    expect(sees.rooms[0]!.messages.some((m) => m.from === 'Heath')).toBe(false);
    expect(sees.names[0]).toMatchObject({ name: 'Heath', blocked: true });
    expect((await g.poll(0)).messages.some((m) => m.from === 'Heath')).toBe(false);
    const refused = await h.say(to('Gorse'), 'Oi again');
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'That name has turned away.' });
    expect((await g.say(to('Heath'), 'no')).status).toBe(400);
    expect((await g.block('Gorse', true)).status).toBe(400);
    expect((await g.block('Nobody Here', true)).status).toBe(404);
    await g.block('Heath', false);
    expect((await h.say(to('Gorse'), 'Oi again')).status).toBe(201);
    expect((await g.fire()).messages.some((m) => m.from === 'Heath')).toBe(true);
  });
});

describe('the poll', () => {
  it('answers at once when there is something newer, else waits for a word and wakes', async () => {
    const [i, j] = await names('Ivy', 'Juniper');
    const before = (await i.overview()).latest;
    await j.say(FIRE, 'Ivy, are you there');
    const ready = await i.poll(before);
    expect(ready.messages.map(said)).toEqual([['Juniper', 'fire', null, 'Ivy, are you there']]);
    expect(ready.latest).toBe(ready.messages[0]!.id);
    expect(ready.here).toBe(1);

    // Nothing new: the poll hangs until Juniper speaks, and while it hangs Ivy is here.
    const pending = i.poll(ready.latest);
    await new Promise((r) => setTimeout(r, 20));
    expect((await j.overview()).here).toBe(2);
    await j.say(to('Ivy'), 'Here.');
    const woke = await pending;
    expect(woke.messages.map(said)).toEqual([['Juniper', null, 'Ivy', 'Here.']]);
    // Juniper's own word wakes Juniper too, so a second tab hears what the first said.
    const own = await j.poll(ready.latest);
    expect(own.messages.map(said)).toEqual([['Juniper', null, 'Ivy', 'Here.']]);
  });

  it('gives up after the wait with nothing, pointing past what the caller cannot hear', async () => {
    const [k, l] = await names('Kestrel', 'Lark');
    const latest = (await k.overview()).latest;
    const t = Date.now();
    const empty = await k.poll(latest);
    expect(Date.now() - t).toBeGreaterThanOrEqual(WAIT_MS - 5);
    expect(empty.messages).toEqual([]);
    expect(empty.latest).toBe(latest);
    // A word Kestrel cannot hear (Lark to Ash) still moves `latest` past itself.
    await l.say(to('Ash'), 'psst');
    const after = await k.poll(latest);
    expect(after.messages).toEqual([]);
    expect(after.latest).toBeGreaterThan(latest);
    expect((await k.call('GET', '/api/chat/poll?after=-1')).status).toBe(400);
    expect((await k.call('GET', '/api/chat/poll?after=x')).status).toBe(400);
  });
});
