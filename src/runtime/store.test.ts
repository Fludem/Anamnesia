import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createNewSave } from '../sim/save.ts';
import { IndexedDbSaveStore, MemorySaveStore, type SaveStore } from './store.ts';

const save = (writerId: string, tick = 0) => {
  const s = createNewSave({ seed: 1, nowMs: 1_000, writerId });
  return { ...s, sim: { ...s.sim, tick } };
};

// Both implementations must satisfy the same contract; the IndexedDB one runs against a fresh
// fake-indexeddb factory per test (never `vi.useFakeTimers()` here — it schedules on setImmediate).
const impls: Array<[string, () => SaveStore]> = [
  ['MemorySaveStore', () => new MemorySaveStore()],
  ['IndexedDbSaveStore', () => new IndexedDbSaveStore(new IDBFactory())],
];

describe.each(impls)('%s', (_name, make) => {
  it('loads null for an empty slot', async () => {
    expect(await make().load('main')).toBeNull();
  });

  it('first write requires expectedCounter 0 and stores counter 1', async () => {
    const store = make();
    const r = await store.write('main', save('a'), 0);
    expect(r).toEqual({ ok: true, saveCounter: 1 });
    const loaded = await store.load('main');
    expect(loaded?.saveCounter).toBe(1);
    expect(loaded?.writerId).toBe('a');
  });

  it('a write with the current counter bumps it', async () => {
    const store = make();
    await store.write('main', save('a'), 0);
    const r = await store.write('main', save('a', 5), 1);
    expect(r).toEqual({ ok: true, saveCounter: 2 });
    expect((await store.load('main'))?.sim.tick).toBe(5);
  });

  it('rejects a write with a lower counter and returns what is stored', async () => {
    const store = make();
    await store.write('main', save('a'), 0);
    await store.write('main', save('a', 10), 1); // counter now 2
    const r = await store.write('main', save('b', 3), 1);
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'stale') throw new Error('expected stale');
    expect(r.stored?.writerId).toBe('a');
    expect(r.stored?.sim.tick).toBe(10);
    // Nothing was overwritten.
    expect((await store.load('main'))?.sim.tick).toBe(10);
  });

  it('rejects a write against an empty slot with a non-zero counter', async () => {
    const r = await make().write('main', save('a'), 3);
    expect(r.ok).toBe(false);
  });

  it('exactly one of two interleaved writers wins', async () => {
    const store = make();
    await store.write('main', save('seed'), 0);
    const [ra, rb] = await Promise.all([
      store.write('main', save('a', 1), 1),
      store.write('main', save('b', 2), 1),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const winner = ra.ok ? 'a' : 'b';
    expect((await store.load('main'))?.writerId).toBe(winner);
    expect((await store.load('main'))?.saveCounter).toBe(2);
  });

  it('clear empties the slot', async () => {
    const store = make();
    await store.write('main', save('a'), 0);
    await store.clear('main');
    expect(await store.load('main')).toBeNull();
    expect((await store.write('main', save('a'), 0)).ok).toBe(true);
  });

  it('load returns a copy, not a live reference', async () => {
    const store = make();
    await store.write('main', save('a'), 0);
    const first = await store.load('main');
    first!.sim.tick = 999;
    expect((await store.load('main'))?.sim.tick).toBe(0);
  });
});
