import { describe, expect, it } from 'vitest';
import { applyPlan, planAdvance } from '../sim/advance.ts';
import { OFFLINE_CAP_TICKS } from '../sim/constants.ts';
import { makeStep } from '../sim/step.ts';
import { fixtureContext, miningState } from '../sim/testing/fixture.ts';
import { runAdvance, type BatchProgress } from './catch-up.ts';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const yieldNow = () => Promise.resolve();
const stepTick = makeStep(fixtureContext);
const createSimState = miningState;

describe('runAdvance', () => {
  it('applies a small plan in one batch with no yield', async () => {
    let yields = 0;
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 300 });
    const r = await runAdvance(createSimState(1), plan, stepTick, {
      yieldToEventLoop: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(r.sim.tick).toBe(3);
    expect(r.wallMs).toBe(T0 + 300);
    expect(r.batches).toBe(1);
    expect(yields).toBe(0);
    expect(r.completed).toBe(true);
  });

  it('batches a long plan, yields between batches, and reports consistent progress', async () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + HOUR }); // 36,000 ticks
    const progress: BatchProgress[] = [];
    let yields = 0;
    const r = await runAdvance(createSimState(1), plan, stepTick, {
      batchTicks: 5_000,
      yieldToEventLoop: () => {
        yields++;
        return Promise.resolve();
      },
      onBatch: (p) => progress.push(p),
    });
    expect(r.batches).toBe(8);
    expect(yields).toBe(7);
    expect(progress.map((p) => p.done)).toEqual([
      5000, 10000, 15000, 20000, 25000, 30000, 35000, 36000,
    ]);
    expect(progress.every((p) => p.total === 36_000)).toBe(true);
    // Every batch's anchor matches its tick: safe to persist mid-way.
    for (const p of progress) expect(p.wallMs).toBe(T0 + p.sim.tick * 100);
    // And the batched result equals the synchronous reference.
    expect(r.sim).toEqual(applyPlan(createSimState(1), plan, stepTick));
  });

  it('is a no-op when run twice over the same range', async () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 10_000 });
    const first = await runAdvance(createSimState(1), plan, stepTick, {
      yieldToEventLoop: yieldNow,
    });
    const events: BatchProgress[] = [];
    const second = await runAdvance(first.sim, plan, stepTick, {
      yieldToEventLoop: yieldNow,
      onBatch: (p) => events.push(p),
    });
    expect(second.sim).toBe(first.sim);
    expect(second.batches).toBe(0);
    expect(events).toHaveLength(0);
    expect(second.wallMs).toBe(first.wallMs);
    expect(second.completed).toBe(true);
  });

  it('resumes a partially applied range without re-processing', async () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 10_000 });
    const half = applyPlan(createSimState(1), plan, stepTick, 40);
    const r = await runAdvance(half, plan, stepTick, {
      batchTicks: 25,
      yieldToEventLoop: yieldNow,
    });
    expect(r.batches).toBe(3); // 60 remaining ticks / 25
    expect(r.sim).toEqual(applyPlan(createSimState(1), plan, stepTick));
  });

  it('runs the full cap (144,000 ticks) and matches the unbatched result', async () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 13 * HOUR });
    const r = await runAdvance(createSimState(7), plan, stepTick, { yieldToEventLoop: yieldNow });
    expect(r.sim.tick).toBe(OFFLINE_CAP_TICKS);
    expect(r.batches).toBe(72);
    expect(r.wallMs).toBe(T0 + 13 * HOUR);
    expect(r.sim).toEqual(applyPlan(createSimState(7), plan, stepTick));
  });

  it('stops at a batch boundary when aborted and reports completed=false', async () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + HOUR });
    const ac = new AbortController();
    let batches = 0;
    const r = await runAdvance(createSimState(1), plan, stepTick, {
      batchTicks: 1_000,
      yieldToEventLoop: () => {
        if (++batches === 3) ac.abort();
        return Promise.resolve();
      },
      signal: ac.signal,
    });
    expect(r.completed).toBe(false);
    expect(r.sim.tick).toBe(3_000);
    expect(r.wallMs).toBe(T0 + 300_000);
  });
});
