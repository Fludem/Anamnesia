import { describe, expect, it } from 'vitest';
import { OFFLINE_CAP_TICKS } from '../sim/constants.ts';
import { createNewSave, type SaveRecord } from '../sim/save.ts';
import { offlineCapTicks } from '../sim/trader.ts';
import { applyCommand, type Command } from '../sim/commands.ts';
import { applyHallSync } from '../sim/hall.ts';
import { countItem } from '../sim/items.ts';
import { reconcileWithContent } from '../sim/reconcile.ts';
import { makeStep } from '../sim/step.ts';
import { fixtureContext } from '../sim/testing/fixture.ts';
import { GameHost, type GameHostOptions, type HostSnapshot } from './game-host.ts';
import { type SaveStore, type WriteResult } from './store.ts';
import { FakeChannelHub } from './testing/fake-channel.ts';
import { FakeTab, FakeWorld, flushMicrotasks } from './testing/fake-env.ts';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/** Move the shared clock and every tab's timers forward together, 100 ms at a time. */
async function elapse(world: FakeWorld, tabs: FakeTab[], ms: number, stepMs = 100): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    world.clock.advance(stepMs);
    for (const tab of tabs) await tab.runTimers(stepMs);
  }
}

/** Wait until an in-flight catch-up (one that shows progress) has finished. */
async function settle(host: GameHost): Promise<void> {
  for (let i = 0; i < 1_000_000 && host.getSnapshot().catchUp !== null; i++)
    await Promise.resolve();
}

/** Host options bound to the fixture content, so command tests don't depend on shipped tuning. */
const FIXTURE: GameHostOptions = {
  step: makeStep(fixtureContext),
  applyAction: (sim, action) => applyCommand(sim, action, fixtureContext),
};
const START_SURE: Command = {
  type: 'action:start',
  request: { kind: 'mining', rock: 'sure-rock', count: null },
};

function boot(tab: FakeTab, options: GameHostOptions = {}): GameHost {
  const host = new GameHost(tab.env, options);
  host.start();
  return host;
}

function seeded(world: FakeWorld, sim: Partial<SaveRecord['sim']> = {}, wallMs = T0): void {
  const save = createNewSave({ seed: 1, nowMs: wallMs, writerId: 'previous' });
  world.store['slots'].set('main', { ...save, saveCounter: 1, sim: { ...save.sim, ...sim } });
}

/** A store whose writes block until released — lets a test order two tabs' writes exactly. */
class GatedStore implements SaveStore {
  private gate: Promise<void> = Promise.resolve();
  private open: (() => void) | null = null;
  constructor(private readonly inner: SaveStore) {}
  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
  }
  release(): void {
    this.open?.();
  }
  load(slot: string): Promise<SaveRecord | null> {
    return this.inner.load(slot);
  }
  async write(slot: string, record: SaveRecord, expected: number): Promise<WriteResult> {
    await this.gate;
    return this.inner.write(slot, record, expected);
  }
  clear(slot: string): Promise<void> {
    return this.inner.clear(slot);
  }
}

describe('GameHost — single tab', () => {
  it('becomes leader, claims the slot, and derives ticks from the clock', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    expect(host.role).toBe('leader');
    expect(host.getSnapshot().sim?.tick).toBe(0);
    expect(world.store.peek('main')?.saveCounter).toBe(1);
    expect(world.store.peek('main')?.writerId).toBe('A');

    await elapse(world, [a], 1_000);
    expect(host.getSnapshot().sim?.tick).toBe(10);

    // Timer starvation: the interval fires once after 5 s of wall time → still exactly 50 ticks.
    world.clock.advance(5_000);
    await a.runTimers(100);
    expect(host.getSnapshot().sim?.tick).toBe(60);
  });

  it('a short absence gives no recap; five minutes away does, diffable against `before`', async () => {
    const world = new FakeWorld(T0);
    seeded(world);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    expect(host.getSnapshot().offline).toBeNull();

    world.clock.advance(4 * 60 * 1_000);
    await a.runTimers(100);
    expect(host.getSnapshot().offline).toBeNull();

    world.clock.advance(5 * 60 * 1_000);
    await a.runTimers(100);
    await a.runTimers(0);
    const snap = host.getSnapshot();
    expect(snap.offline).toMatchObject({ awayMs: 5 * 60 * 1_000, skippedTicks: 0 });
    expect(snap.offline?.before.tick).toBe(2_400);
    expect(snap.sim?.tick).toBe(5_400);
    host.dismissOffline();
    expect(host.getSnapshot().offline).toBeNull();
  });

  it('saves periodically and on visibilitychange→hidden', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a, { saveIntervalMs: 1_000 });
    await flushMicrotasks();
    await elapse(world, [a], 1_000);
    expect(world.store.peek('main')?.saveCounter).toBe(2);
    expect(world.store.peek('main')?.sim.tick).toBe(10);

    await elapse(world, [a], 500);
    a.lifecycle.fireHidden();
    await flushMicrotasks();
    expect(world.store.peek('main')?.saveCounter).toBe(3);
    expect(world.store.peek('main')?.sim.tick).toBe(15);
    expect(host.getSnapshot().lastSavedAtMs).toBe(world.clock.now());
  });

  it('clock jumps back an hour → state unchanged, no crash, then resumes at the right rate', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    await elapse(world, [a], 2_000);
    const before = structuredClone(host.getSnapshot().sim);
    expect(before?.tick).toBe(20);

    world.clock.set(world.clock.now() - HOUR);
    await a.runTimers(100);
    expect(host.getSnapshot().sim).toEqual(before);
    expect(host.role).toBe('leader');

    await elapse(world, [a], 1_000);
    expect(host.getSnapshot().sim?.tick).toBe(30);
  });

  it('applies offline progress once, with progress events, capped at the night and reported', async () => {
    const world = new FakeWorld(T0 + 5 * HOUR);
    seeded(world);
    const a = world.tab('A');
    const host = boot(a);
    const progress: number[] = [];
    host.subscribe(() => {
      const c = host.getSnapshot().catchUp;
      if (c) progress.push(c.done);
    });
    await flushMicrotasks();
    await a.runTimers(0);

    const snap = host.getSnapshot();
    expect(snap.role).toBe('leader');
    expect(snap.sim?.tick).toBe(OFFLINE_CAP_TICKS);
    expect(snap.wallMs).toBe(T0 + 5 * HOUR);
    expect(snap.offline).toMatchObject({
      skippedTicks: 36_000,
      awayMs: 5 * HOUR,
      capMs: 4 * HOUR,
    });
    expect(snap.offline?.before.tick).toBe(0);
    expect(snap.catchUp).toBeNull();
    expect(progress.length).toBeGreaterThan(10);
    expect(progress.at(-1)).toBe(OFFLINE_CAP_TICKS);

    const stored = world.store.peek('main');
    expect(stored?.sim.tick).toBe(OFFLINE_CAP_TICKS);
    expect(stored?.wallMs).toBe(T0 + 5 * HOUR);
    expect(stored?.writerId).toBe('A');
    // claim + catch-up, nothing else.
    expect(world.store.log.filter((l) => l.op === 'write')).toHaveLength(2);
  }, 20_000);

  it('does not double-apply when the timer fires mid-catch-up (re-entrancy guard)', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    let steps = 0;
    const host = boot(a, {
      step: (s) => {
        steps++;
        return makeStep(fixtureContext)(s);
      },
      batchTicks: 2_000,
    });
    // Each yield between batches also fires the tick interval, as a real event loop would.
    a.env.yieldToEventLoop = () => a.scheduler.tick(100);
    await flushMicrotasks();
    await elapse(world, [a], 1_000);
    expect(steps).toBe(10);

    world.clock.advance(HOUR); // hidden for an hour, then the throttled timer fires once
    await a.runTimers(100);
    await settle(host);
    expect(host.getSnapshot().sim?.tick).toBe(36_010);
    expect(steps).toBe(36_010);
    expect(host.getSnapshot().wallMs).toBe(world.clock.now());
  });

  it('a save with a lamp is capped at the lamp, and the recap says so', async () => {
    const world = new FakeWorld(T0 + 13 * HOUR);
    seeded(world, { upgrades: { lamp: 1 } });
    const a = world.tab('A');
    const host = boot(a, {
      ...FIXTURE,
      capTicksFor: (sim) => offlineCapTicks(sim, fixtureContext),
    });
    await flushMicrotasks();
    await a.runTimers(0);
    const snap = host.getSnapshot();
    expect(snap.sim?.tick).toBe((13 * HOUR) / 100);
    expect(snap.offline).toMatchObject({ skippedTicks: 0, awayMs: 13 * HOUR, capMs: 16 * HOUR });
  });

  it('a save taken mid-catch-up is consistent and the remainder resumes on next load', async () => {
    const world = new FakeWorld(T0 + HOUR);
    seeded(world);
    const a = world.tab('A');
    let saved: SaveRecord | undefined;
    const host = boot(a, { batchTicks: 1_000 });
    let batches = 0;
    a.env.yieldToEventLoop = async () => {
      if (++batches === 5) {
        a.lifecycle.fireHidden();
        await flushMicrotasks();
        saved = structuredClone(world.store.peek('main'));
      }
    };
    await flushMicrotasks();
    await a.runTimers(0);
    expect(saved?.sim.tick).toBe(5_000);
    expect(saved?.wallMs).toBe(T0 + 500_000);
    expect(host.getSnapshot().sim?.tick).toBe(36_000);
  });

  it('a save naming content that is gone boots, minus those things, instead of crashing', async () => {
    const world = new FakeWorld(T0);
    seeded(
      world,
      {
        action: {
          current: {
            request: { kind: 'mining', rock: 'coal-rock', count: null },
            elapsedTicks: 0,
            durationTicks: 3,
            remaining: null,
          },
          queue: [],
        },
        bank: [{ item: 'coal', qty: 7 }],
      },
      T0 - HOUR,
    );
    const a = world.tab('A');
    const host = boot(a, {
      ...FIXTURE,
      reconcile: (sim) => reconcileWithContent(sim, fixtureContext.content).sim,
    });
    await flushMicrotasks();
    await settle(host);
    expect(host.getSnapshot().error).toBeNull();
    expect(host.role).toBe('leader');
    const sim = host.getSnapshot().sim!;
    expect(sim.action.current).toBeNull();
    expect(sim.bank).toEqual([]);
    expect(sim.tick).toBe(HOUR / 100);
  });

  it('writes the account’s name over the save’s own', async () => {
    const world = new FakeWorld(T0);
    seeded(world, { player: { name: 'Old Name', god: null } });
    const a = world.tab('A');
    const host = boot(a, { ...FIXTURE, playerName: 'Sisyphus' });
    await flushMicrotasks();
    expect(host.getSnapshot().sim?.player.name).toBe('Sisyphus');
    expect(world.store.peek('main')?.sim.player.name).toBe('Sisyphus');
  });

  it('keeps playing when the store cannot be reached, and says so until a save lands', async () => {
    const world = new FakeWorld(T0);
    let down = false;
    const flaky: SaveStore = {
      load: (slot) => world.store.load(slot),
      write: (slot, record, expected) =>
        down
          ? Promise.resolve({ ok: false, reason: 'unreachable', message: 'no road' })
          : world.store.write(slot, record, expected),
      clear: (slot) => world.store.clear(slot),
    };
    const a = world.tab('A', { store: flaky });
    const host = boot(a, { ...FIXTURE, saveIntervalMs: 1_000 });
    await flushMicrotasks();
    expect(host.role).toBe('leader');
    down = true;
    await elapse(world, [a], 1_100);
    expect(host.role).toBe('leader');
    expect(host.getSnapshot().saveProblem).toBe('no road');
    expect(host.getSnapshot().error).toBeNull();
    expect(world.store.peek('main')?.sim.tick).toBe(0);
    expect(host.getSnapshot().sim?.tick).toBe(11);
    down = false;
    await elapse(world, [a], 1_000);
    expect(host.getSnapshot().saveProblem).toBeNull();
    expect(world.store.peek('main')?.sim.tick).toBeGreaterThanOrEqual(20);
  });

  it('applies what the register says about the hall after a write, without saving again', async () => {
    const world = new FakeWorld(T0);
    seeded(world, {
      bank: [{ item: 'log', qty: 30 }],
      hall: { id: 7, rooms: {}, gifts: [], given: 0 },
    });
    // A register: takes up to 10 logs for the hearth and says so with the write.
    let answers = 0;
    let rooms: Record<string, number> = {};
    const register: SaveStore = {
      load: (slot) => world.store.load(slot),
      write: async (slot, record, expected) => {
        const r = await world.store.write(slot, record, expected);
        if (!r.ok) return r;
        answers++;
        const took = record.sim.hall.gifts.map((g) => ({ id: g.id, qty: Math.min(10, g.qty) }));
        if (took.some((t) => t.qty === 10)) rooms = { hearth: 1 };
        return { ...r, hall: { id: 7, rooms, took, given: record.sim.hall.given } };
      },
      clear: (slot) => world.store.clear(slot),
    };
    const a = world.tab('A', { store: register });
    const host = boot(a, {
      ...FIXTURE,
      applySync: (sim, hall) => applyHallSync(sim, hall, fixtureContext),
      reconcile: (sim) => reconcileWithContent(sim, fixtureContext.content).sim,
      saveIntervalMs: 1_000,
    });
    await flushMicrotasks();
    expect(host.role).toBe('leader');
    const writesBefore = world.store.log.filter((l) => l.op === 'write').length;
    host.dispatch({ type: 'hall:give', room: 'hearth', item: 'log', qty: 14 });
    await flushMicrotasks();
    await a.runTimers(0);
    await flushMicrotasks();
    const sim = host.getSnapshot().sim!;
    // The command saved once; the answer came back on that write and was applied, not saved.
    expect(world.store.log.filter((l) => l.op === 'write')).toHaveLength(writesBefore + 1);
    expect(sim.hall.gifts).toEqual([]);
    expect(sim.hall.rooms).toEqual({ hearth: 1 });
    expect(countItem(sim.bank, 'log')).toBe(30 - 14 + 4);
    expect(world.store.peek('main')?.sim.hall.gifts).toHaveLength(1);
    // The next periodic save carries the cleared cart; an answer with nothing new changes nothing.
    await elapse(world, [a], 1_100);
    expect(world.store.peek('main')?.sim.hall.gifts).toEqual([]);
    expect(answers).toBeGreaterThanOrEqual(2);
    expect(host.getSnapshot().sim?.hall.rooms).toEqual({ hearth: 1 });
  });

  it('refuses to start over an unreadable save', async () => {
    const world = new FakeWorld(T0);
    world.store['slots'].set('main', { version: 42 } as unknown as SaveRecord);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    expect(host.role).toBe('error');
    expect(host.getSnapshot().error).toMatch(/newer/);
    expect(world.store.log.filter((l) => l.op === 'write')).toHaveLength(0);
  });

  it('runs guard-only with a warning when Web Locks is unavailable', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A', { locks: null });
    const host = boot(a);
    await flushMicrotasks();
    expect(host.role).toBe('leader');
    expect(host.getSnapshot().warning).toMatch(/Web Locks/);
  });

  it('pagehide flushes and releases the lock; a bfcache restore reloads', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    await elapse(world, [a], 700);
    a.lifecycle.firePageHide();
    await flushMicrotasks();
    expect(host.role).toBe('stale');
    expect(world.store.peek('main')?.sim.tick).toBe(7);
    expect(world.locks.isHeld('anamnesia:leader')).toBe(false);
    a.lifecycle.firePageShow(true);
    expect(a.reloads).toBe(1);
  });
});

describe('GameHost — two tabs', () => {
  // Followers lag the leader by up to snapshotIntervalMs; these tests assert exact mirroring,
  // so the throttle is off.
  const exact: GameHostOptions = { snapshotIntervalMs: 0 };

  async function leaderAndFollower(world: FakeWorld) {
    const a = world.tab('A');
    const b = world.tab('B');
    const ha = boot(a, exact);
    await flushMicrotasks();
    const hb = boot(b, exact);
    await flushMicrotasks();
    await elapse(world, [a, b], 500);
    return { a, b, ha, hb };
  }

  it('second tab is a follower that mirrors the leader and never touches storage', async () => {
    const world = new FakeWorld(T0);
    const { a, b, ha, hb } = await leaderAndFollower(world);
    expect(ha.role).toBe('leader');
    expect(hb.role).toBe('follower');
    expect(hb.getSnapshot().leaderId).toBe('A');
    expect(hb.getSnapshot().sim?.tick).toBe(ha.getSnapshot().sim?.tick);
    expect(hb.getSnapshot().sim?.tick).toBe(5);
    expect(world.store.log.filter((l) => l.op === 'load')).toHaveLength(1);
    expect(world.store.log.every((l) => l.op !== 'write' || l.writerId === 'A')).toBe(true);

    await elapse(world, [a, b], 1_000);
    expect(hb.getSnapshot().sim?.tick).toBe(15);
    expect(b.scheduler.pending).toBe(0); // no tick loop on the follower
  });

  it("follower's write is rejected by the counter guard and it reloads (lock mechanism failed)", async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const ha = boot(a);
    await flushMicrotasks();
    await elapse(world, [a], 300);

    // B believes it is the leader (its lock manager is disconnected from A's) and has loaded
    // the save at counter 1. Before B can write, A writes again.
    const gated = new GatedStore(world.store);
    const b = world.tab('B', { locks: null, store: gated });
    gated.hold();
    const hb = boot(b);
    await flushMicrotasks();
    expect(hb.role).toBe('leader');
    expect(hb.getSnapshot().saveCounter).toBe(1);

    await ha.saveNow();
    expect(world.store.peek('main')?.saveCounter).toBe(2);

    gated.release();
    await flushMicrotasks();
    await b.runTimers(0);

    expect(hb.role).toBe('stale');
    expect(b.reloads).toBe(1);
    expect(a.reloads).toBe(0);
    const stored = world.store.peek('main');
    expect(stored?.writerId).toBe('A');
    expect(stored?.saveCounter).toBe(2);
    expect(stored?.sim.tick).toBe(3);
  });

  it('with onStale: hold, a rejected write stops the tab, keeps the lock and reloads nothing', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const c = world.tab('C');
    const ha = boot(a, { onStale: 'hold' });
    await flushMicrotasks();
    const hc = boot(c, { onStale: 'hold' });
    await flushMicrotasks();
    await elapse(world, [a, c], 300);
    expect(hc.role).toBe('follower');

    // B is another device: no shared lock. It loads the save at counter 1 and claims it.
    const b = world.tab('B', { locks: null });
    const hb = boot(b, { onStale: 'hold' });
    await flushMicrotasks();
    expect(hb.role).toBe('leader');
    expect(world.store.peek('main')?.writerId).toBe('B');

    // A's next save is the stale one: A stops without reloading, and C is not promoted.
    await ha.saveNow();
    expect(ha.role).toBe('stale');
    expect(a.reloads).toBe(0);
    expect(world.locks.isHeld('anamnesia:leader')).toBe(true);
    await elapse(world, [a, b, c], 500);
    expect(hc.role).toBe('follower');
    expect(hb.role).toBe('leader');
    expect(world.store.peek('main')?.writerId).toBe('B');
  });

  it('catch-up is applied only by the tab holding the lock', async () => {
    const world = new FakeWorld(T0 + HOUR);
    seeded(world);
    const a = world.tab('A');
    const b = world.tab('B');
    const ha = boot(a, exact);
    const hb = boot(b, exact);
    await flushMicrotasks();
    await elapse(world, [a, b], 500);
    expect(ha.role).toBe('leader');
    expect(hb.role).toBe('follower');
    expect(ha.getSnapshot().sim?.tick).toBe(36_005);
    expect(hb.getSnapshot().sim?.tick).toBe(36_005);
    expect(world.store.log.filter((l) => l.op === 'load')).toHaveLength(1);
  });

  it('take over: leader flushes and acks, follower steals, old leader becomes follower', async () => {
    const world = new FakeWorld(T0);
    const { a, b, ha, hb } = await leaderAndFollower(world);
    const counterBefore = world.store.peek('main')?.saveCounter ?? 0;

    hb.takeOver();
    await elapse(world, [a, b], 500);

    expect(hb.role).toBe('leader');
    expect(ha.role).toBe('follower');
    expect(ha.getSnapshot().leaderId).toBe('B');
    const stored = world.store.peek('main');
    expect(stored?.writerId).toBe('B');
    // handover flush by A, then claim by B
    expect(stored?.saveCounter).toBe(counterBefore + 2);
    expect(hb.getSnapshot().takeoverPending).toBe(false);

    // A straggler write from A with its pre-handover counter is the one rejected.
    const straggler = await world.store.write(
      'main',
      { ...stored!, writerId: 'A' },
      counterBefore + 1,
    );
    expect(straggler.ok).toBe(false);

    // Ticking continues on B and A mirrors it; nothing was lost across the handover.
    const tickAtHandover = stored!.sim.tick;
    await elapse(world, [a, b], 1_000);
    expect(hb.getSnapshot().sim?.tick).toBeGreaterThanOrEqual(tickAtHandover + 10);
    expect(ha.getSnapshot().sim?.tick).toBe(hb.getSnapshot().sim?.tick);
    expect(a.reloads + b.reloads).toBe(0);
  });

  it('closing the leader promotes the queued follower automatically', async () => {
    const world = new FakeWorld(T0);
    const { a, b, ha, hb } = await leaderAndFollower(world);
    a.lifecycle.firePageHide();
    await flushMicrotasks();
    ha.stop();
    await elapse(world, [b], 300);
    expect(hb.role).toBe('leader');
    expect(hb.getSnapshot().sim?.tick).toBe(8);
    expect(world.store.peek('main')?.writerId).toBe('B');
  });

  it('a frozen leader that never acks is stolen from after the timeout', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const ha = boot(a);
    await flushMicrotasks();
    // B shares the lock manager and store but its channel goes nowhere: A never hears it.
    const isolated = new FakeChannelHub();
    const b = world.tab('B', { openChannel: (n) => isolated.open(n) });
    const hb = boot(b, { takeoverAckTimeoutMs: 2_000 });
    await elapse(world, [a, b], 500);
    expect(hb.role).toBe('follower');
    hb.takeOver();
    await elapse(world, [a, b], 1_500);
    expect(hb.role).toBe('follower'); // still waiting for an ack that will never come
    await elapse(world, [a, b], 1_000);
    expect(hb.role).toBe('leader');
    expect(ha.role).toBe('follower');
    expect(world.store.peek('main')?.writerId).toBe('B');
  });

  it('leader resumes if a takeover request is never followed by a steal', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const ha = boot(a, { handoverResumeMs: 1_000 });
    await flushMicrotasks();
    const phantom = world.hub.open('anamnesia:game');
    phantom.postMessage({ type: 'takeover-request', tabId: 'ghost' });
    await flushMicrotasks();
    expect(ha.role).toBe('handing-over');
    await elapse(world, [a], 1_200);
    expect(ha.role).toBe('leader');
    await elapse(world, [a], 1_000);
    expect(ha.getSnapshot().sim?.tick).toBe(22);
  });

  it("a follower's action is forwarded to the leader", async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const b = world.tab('B');
    const received: string[] = [];
    boot(a, { onAction: (action, from) => received.push(`${action.type}@${from}`) });
    await flushMicrotasks();
    const hb = boot(b);
    await flushMicrotasks();
    hb.dispatch({ type: 'action:stop' });
    await flushMicrotasks();
    expect(received).toEqual(['action:stop@B']);
  });

  it('a command on the leader changes the sim, is saved, and is mirrored to followers', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const b = world.tab('B');
    const ha = boot(a, { ...FIXTURE, snapshotIntervalMs: 0 });
    await flushMicrotasks();
    const hb = boot(b, FIXTURE);
    await flushMicrotasks();
    const writesBefore = world.store.log.filter((l) => l.op === 'write').length;

    ha.dispatch(START_SURE);
    await flushMicrotasks();
    expect(ha.getSnapshot().sim?.action.current?.request).toEqual(START_SURE.request);
    expect(hb.getSnapshot().sim?.action.current?.request).toEqual(START_SURE.request);
    expect(world.store.log.filter((l) => l.op === 'write')).toHaveLength(writesBefore + 1);

    await elapse(world, [a, b], 3_000);
    expect(countItem(ha.getSnapshot().sim?.bank ?? [], 'stone')).toBe(10);
    expect(hb.getSnapshot().sim).toEqual(ha.getSnapshot().sim);
  });

  it("a follower's command is applied by the leader, not locally", async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const b = world.tab('B');
    const ha = boot(a, { ...FIXTURE, snapshotIntervalMs: 0 });
    await flushMicrotasks();
    const hb = boot(b, FIXTURE);
    await flushMicrotasks();

    hb.dispatch(START_SURE);
    await flushMicrotasks();
    expect(ha.getSnapshot().sim?.action.current?.request).toEqual(START_SURE.request);
    await elapse(world, [a, b], 300);
    expect(countItem(hb.getSnapshot().sim?.bank ?? [], 'stone')).toBe(1);
    expect(world.store.peek('main')?.writerId).toBe('A');
  });

  it('a rejected command surfaces its reason and leaves the sim untouched', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a, FIXTURE);
    await flushMicrotasks();
    const before = host.getSnapshot().sim;
    host.dispatch({
      type: 'action:start',
      request: { kind: 'mining', rock: 'gated-rock', count: null },
    });
    await flushMicrotasks();
    expect(host.getSnapshot().commandError).toBe('requires Mining level 10 (you are 1)');
    expect(host.getSnapshot().sim).toBe(before);
    host.dispatch(START_SURE);
    expect(host.getSnapshot().commandError).toBeNull();
  });

  it('a command that arrives mid-catch-up is applied after the derived range, not inside it', async () => {
    const world = new FakeWorld(T0 + HOUR);
    seeded(world);
    const a = world.tab('A');
    const host = boot(a, { ...FIXTURE, batchTicks: 1_000 });
    let batches = 0;
    a.env.yieldToEventLoop = () => {
      if (++batches === 5) host.dispatch(START_SURE);
      return Promise.resolve();
    };
    await flushMicrotasks();
    await a.runTimers(0);
    await settle(host);
    const sim = host.getSnapshot().sim;
    expect(sim?.tick).toBe(36_000);
    expect(sim?.action.current?.request).toEqual(START_SURE.request);
    expect(sim?.bank).toEqual([]); // nothing mined inside the catch-up
    await elapse(world, [a], 300);
    expect(countItem(host.getSnapshot().sim?.bank ?? [], 'stone')).toBe(1);
  });

  it('getSnapshot is referentially stable between changes', async () => {
    const world = new FakeWorld(T0);
    const a = world.tab('A');
    const host = boot(a);
    await flushMicrotasks();
    const s1: HostSnapshot = host.getSnapshot();
    expect(host.getSnapshot()).toBe(s1);
    await elapse(world, [a], 100);
    expect(host.getSnapshot()).not.toBe(s1);
  });
});
