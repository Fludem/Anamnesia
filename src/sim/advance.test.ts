import { describe, expect, it } from 'vitest';
import { applyPlan, planAdvance, planTickCount, wallMsAt } from './advance.ts';
import { OFFLINE_CAP_TICKS, TICK_MS } from './constants.ts';
import { createSimState } from './save.ts';
import { stepTick } from './step.ts';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

describe('planAdvance', () => {
  it('yields zero ticks when no time has passed', () => {
    const plan = planAdvance({ tick: 10, wallMs: T0, nowMs: T0 });
    expect(planTickCount(plan)).toBe(0);
    expect(plan.newWallMs).toBe(T0);
    expect(plan.clockWentBackwards).toBe(false);
  });

  it('derives exactly elapsed / TICK_MS ticks', () => {
    const plan = planAdvance({ tick: 10, wallMs: T0, nowMs: T0 + 1_000 });
    expect(plan.fromTick).toBe(10);
    expect(plan.toTick).toBe(20);
    expect(plan.newWallMs).toBe(T0 + 1_000);
  });

  it('carries the sub-tick remainder in the anchor (150ms + 150ms = 3 ticks, not 2)', () => {
    const a = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 150 });
    expect(planTickCount(a)).toBe(1);
    expect(a.newWallMs).toBe(T0 + 100);
    const b = planAdvance({ tick: a.toTick, wallMs: a.newWallMs, nowMs: T0 + 300 });
    expect(planTickCount(b)).toBe(2);
    expect(b.toTick).toBe(3);
  });

  it('clamps a backwards clock to zero ticks and re-anchors', () => {
    const plan = planAdvance({ tick: 500, wallMs: T0, nowMs: T0 - HOUR });
    expect(planTickCount(plan)).toBe(0);
    expect(plan.toTick).toBe(500);
    expect(plan.clockWentBackwards).toBe(true);
    expect(plan.newWallMs).toBe(T0 - HOUR);
    // …and the very next second of real time produces exactly 10 ticks.
    const next = planAdvance({
      tick: plan.toTick,
      wallMs: plan.newWallMs,
      nowMs: T0 - HOUR + 1_000,
    });
    expect(planTickCount(next)).toBe(10);
  });

  it('treats NaN timestamps as no progress rather than crashing', () => {
    const plan = planAdvance({ tick: 5, wallMs: Number.NaN, nowMs: T0 });
    expect(planTickCount(plan)).toBe(0);
  });

  it('is not capped at exactly the cap', () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 12 * HOUR });
    expect(planTickCount(plan)).toBe(OFFLINE_CAP_TICKS);
    expect(plan.skippedTicks).toBe(0);
    expect(plan.newWallMs).toBe(T0 + 12 * HOUR);
  });

  it('caps one tick past the cap and discards the excess', () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 12 * HOUR + TICK_MS });
    expect(planTickCount(plan)).toBe(OFFLINE_CAP_TICKS);
    expect(plan.skippedTicks).toBe(1);
    expect(plan.newWallMs).toBe(T0 + 12 * HOUR + TICK_MS);
  });

  it('reports skipped ticks for a 13h absence', () => {
    const plan = planAdvance({ tick: 7, wallMs: T0, nowMs: T0 + 13 * HOUR });
    expect(plan.toTick).toBe(7 + OFFLINE_CAP_TICKS);
    expect(plan.skippedTicks).toBe(36_000);
  });

  it('honours custom tick length and cap', () => {
    const plan = planAdvance({ tick: 0, wallMs: 0, nowMs: 10_000, tickMs: 1_000, capTicks: 4 });
    expect(planTickCount(plan)).toBe(4);
    expect(plan.skippedTicks).toBe(6);
  });
});

describe('wallMsAt', () => {
  const plan = planAdvance({ tick: 100, wallMs: T0, nowMs: T0 + 5_000 });
  it('interpolates inside the plan and clamps outside', () => {
    expect(wallMsAt(plan, 100)).toBe(T0);
    expect(wallMsAt(plan, 120)).toBe(T0 + 2_000);
    expect(wallMsAt(plan, 150)).toBe(T0 + 5_000);
    expect(wallMsAt(plan, 99)).toBe(T0);
    expect(wallMsAt(plan, 999)).toBe(plan.newWallMs);
  });
  it('returns the discarded-excess anchor when a plan is capped', () => {
    const capped = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 13 * HOUR });
    expect(wallMsAt(capped, capped.toTick)).toBe(T0 + 13 * HOUR);
    expect(wallMsAt(capped, 10)).toBe(T0 + 1_000);
  });
});

describe('applyPlan', () => {
  it('runs exactly the planned ticks through step', () => {
    const s0 = createSimState(1);
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 2_500 });
    const s1 = applyPlan(s0, plan, stepTick);
    expect(s1.tick).toBe(25);
    expect(s1.placeholder.draws).toBe(25);
  });

  it('is a no-op for a plan already covered by state.tick (idempotent)', () => {
    const s0 = createSimState(1);
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 2_500 });
    const s1 = applyPlan(s0, plan, stepTick);
    const s2 = applyPlan(s1, plan, stepTick);
    expect(s2).toBe(s1);
  });

  it('only processes the part of a range not yet covered', () => {
    const s0 = createSimState(1);
    const whole = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 1_000 });
    const direct = applyPlan(s0, whole, stepTick);
    const half = applyPlan(s0, whole, stepTick, 4);
    expect(half.tick).toBe(4);
    const rest = applyPlan(half, whole, stepTick);
    expect(rest).toEqual(direct);
  });

  it('produces identical state regardless of batch size (the fast-path proof shape)', () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 60 * 60 * 1_000 }); // 36,000 ticks
    const run = (batch: number) => {
      let s = createSimState(12345);
      while (s.tick < plan.toTick) s = applyPlan(s, plan, stepTick, batch);
      return s;
    };
    const reference = run(Number.POSITIVE_INFINITY);
    expect(run(1)).toEqual(reference);
    expect(run(7)).toEqual(reference);
    expect(run(2_000)).toEqual(reference);
    expect(reference.tick).toBe(36_000);
  });

  it('rejects a step that does not advance the tick by one', () => {
    const plan = planAdvance({ tick: 0, wallMs: T0, nowMs: T0 + 100 });
    expect(() => applyPlan(createSimState(1), plan, (s) => s)).toThrow(/exactly 1/);
  });
});
