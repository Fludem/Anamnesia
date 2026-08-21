import { describe, expect, it } from 'vitest';
import { ActionRequestSchema, beginAction, startNextQueued } from './actions.ts';
import { applyCommand, CommandSchema } from './commands.ts';
import { countItem } from './items.ts';
import { addXp } from './progress.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};
const sure = (count: number | null = null) =>
  ({ kind: 'mining', rock: 'sure-rock', count }) as const;
const flaky = (count: number | null = null) =>
  ({ kind: 'mining', rock: 'flaky-rock', count }) as const;
const start = (s: SimState, request: ReturnType<typeof sure> | ReturnType<typeof flaky>) => {
  const r = applyCommand(s, { type: 'action:start', request }, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('action queue', () => {
  it('a counted action stops after exactly that many cycles', () => {
    const s = run(start(createSimState(1), sure(3)), 100);
    expect(countItem(s.bank, 'stone')).toBe(3);
    expect(s.action.current).toBeNull();
    expect(s.tick).toBe(100);
  });

  it('remaining counts down and is visible mid-run', () => {
    let s = start(createSimState(1), sure(3));
    expect(s.action.current?.remaining).toBe(3);
    s = run(s, 3);
    expect(s.action.current?.remaining).toBe(2);
    s = run(s, 5);
    expect(s.action.current).toMatchObject({ remaining: 1, elapsedTicks: 2 });
  });

  it('moves on to the next queued request the tick the count completes', () => {
    let s = start(createSimState(1), sure(2));
    const r = applyCommand(s, { type: 'action:enqueue', request: flaky() }, ctx);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.action.queue).toHaveLength(1);
    s = run(s, 5);
    expect(s.action.current?.request.rock).toBe('sure-rock');
    s = run(s, 1);
    expect(countItem(s.bank, 'stone')).toBe(2);
    expect(s.action.current).toMatchObject({
      request: { rock: 'flaky-rock' },
      elapsedTicks: 0,
      durationTicks: 4,
      remaining: null,
    });
    expect(s.action.queue).toEqual([]);
  });

  it('enqueue on an idle state starts immediately', () => {
    const r = applyCommand(createSimState(1), { type: 'action:enqueue', request: sure() }, ctx);
    expect(r.ok && r.state.action.current?.request.rock).toBe('sure-rock');
  });

  it('start replaces the current action and clears the queue; progress is lost', () => {
    let s = start(createSimState(1), sure());
    s = applyCommand(s, { type: 'action:enqueue', request: sure(1) }, ctx).state;
    s = run(s, 2);
    expect(s.action.current?.elapsedTicks).toBe(2);
    s = start(s, flaky());
    expect(s.action.current).toMatchObject({ request: { rock: 'flaky-rock' }, elapsedTicks: 0 });
    expect(s.action.queue).toEqual([]);
  });

  it('stop clears everything and the sim goes idle', () => {
    let s = start(createSimState(1), sure());
    s = applyCommand(s, { type: 'action:enqueue', request: flaky() }, ctx).state;
    const stopped = applyCommand(s, { type: 'action:stop' }, ctx);
    expect(stopped.ok).toBe(true);
    expect(stopped.state.action).toEqual({ current: null, queue: [] });
    expect(run(stopped.state, 50).bank).toEqual([]);
  });

  it('rejects requests the player cannot start, leaving state untouched', () => {
    const s = createSimState(1);
    const gated = { kind: 'mining', rock: 'gated-rock', count: null } as const;
    const r = applyCommand(s, { type: 'action:start', request: gated }, ctx);
    expect(r).toEqual({ ok: false, state: s, reason: 'requires Mining level 10 (you are 1)' });
    expect(applyCommand(s, { type: 'action:enqueue', request: gated }, ctx).ok).toBe(false);
    const levelled = addXp(s, 'mining', ctx.xp.xpForLevel(10));
    expect(applyCommand(levelled, { type: 'action:start', request: gated }, ctx).ok).toBe(true);
  });

  it('queued requests that can no longer start are skipped rather than blocking the queue', () => {
    const s0: SimState = {
      ...createSimState(1),
      action: {
        current: null,
        queue: [
          { kind: 'mining', rock: 'gated-rock', count: null },
          { kind: 'mining', rock: 'removed-rock', count: null },
          sure(),
        ],
      },
    };
    const s = startNextQueued(s0, ctx);
    expect(s.action.current?.request.rock).toBe('sure-rock');
    expect(s.action.queue).toEqual([]);
  });

  it('beginAction snapshots the duration at start', () => {
    const s = beginAction(createSimState(1), flaky(), ctx);
    expect(s.action.current?.durationTicks).toBe(4);
  });

  it('schemas apply the count default and reject malformed commands', () => {
    expect(ActionRequestSchema.parse({ kind: 'mining', rock: 'sure-rock' })).toEqual(sure());
    expect(CommandSchema.safeParse({ type: 'action:start' }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'noop' }).success).toBe(false);
    expect(
      CommandSchema.safeParse({ type: 'action:start', request: { kind: 'mining', rock: 'Bad Id' } })
        .success,
    ).toBe(false);
  });
});
