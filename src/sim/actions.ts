import { z } from 'zod';
import { combatStyle } from './combat.ts';
import { IdSchema } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { pushEvent } from './events.ts';
import { rollFinds } from './finds.ts';
import { nextFloat } from './rng.ts';
import type { SimState } from './save.ts';
import { combatHandler } from './skills/combat.ts';
import { craftingHandler } from './skills/crafting.ts';
import { fishingHandler } from './skills/fishing.ts';
import { foragingHandler } from './skills/foraging.ts';
import { miningHandler } from './skills/mining.ts';
import { woodcuttingHandler } from './skills/woodcutting.ts';

/**
 * The one primitive every activity is built on: an action with a duration in ticks, a success
 * roll when the duration elapses, and an outcome. Gathering, crafting and combat are all
 * handlers of this shape; the tick loop only knows about the primitive.
 */

/** What the player asked for. `count: null` repeats until stopped. */
const Count = z.number().int().min(1).nullable().default(null);
export const ActionRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mining'), rock: IdSchema, count: Count }),
  z.object({ kind: z.literal('woodcutting'), tree: IdSchema, count: Count }),
  z.object({ kind: z.literal('fishing'), water: IdSchema, count: Count }),
  z.object({ kind: z.literal('foraging'), patch: IdSchema, count: Count }),
  z.object({ kind: z.literal('crafting'), recipe: IdSchema, count: Count }),
  /** Fight `monster` until stopped; a cycle is one swing, so `count` is swings. */
  z.object({ kind: z.literal('combat'), monster: IdSchema, count: Count }),
]);
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export type ActionKind = ActionRequest['kind'];
export type RequestOf<K extends ActionKind> = Extract<ActionRequest, { kind: K }>;

/** The request in flight plus its cycle progress. */
export const ActiveActionSchema = z.object({
  request: ActionRequestSchema,
  durationTicks: z.number().int().min(1),
  elapsedTicks: z.number().int().min(0),
  /** Cycles still to run including the current one; `null` = until stopped. */
  remaining: z.number().int().min(1).nullable(),
});
export type ActiveAction = z.infer<typeof ActiveActionSchema>;

export const ActionQueueSchema = z.object({
  current: ActiveActionSchema.nullable(),
  /** Runs in order once `current` finishes its count. */
  queue: z.array(ActionRequestSchema),
});
export type ActionQueue = z.infer<typeof ActionQueueSchema>;

export type StartCheck = { ok: true } | { ok: false; reason: string };

export interface ActionHandler<K extends ActionKind> {
  canStart(state: SimState, req: RequestOf<K>, ctx: SimContext): StartCheck;
  durationTicks(state: SimState, req: RequestOf<K>, ctx: SimContext): number;
  /** Probability in [0, 1] that a completed cycle succeeds. */
  successChance(state: SimState, req: RequestOf<K>, ctx: SimContext): number;
  /** Apply the cycle's outcome. Draws from `state.rng` as needed and returns the new state. */
  resolve(state: SimState, req: RequestOf<K>, success: boolean, ctx: SimContext): SimState;
  /**
   * Runs every tick the action is active, before the cycle advances. For things on their own
   * clock (the monster's swings). May end the action by clearing `action.current`.
   */
  tick?(state: SimState, req: RequestOf<K>, ctx: SimContext): SimState;
}

const HANDLERS: { [K in ActionKind]: ActionHandler<K> } = {
  mining: miningHandler,
  woodcutting: woodcuttingHandler,
  fishing: fishingHandler,
  foraging: foragingHandler,
  crafting: craftingHandler,
  combat: combatHandler,
};

export function actionHandler<K extends ActionKind>(kind: K): ActionHandler<K> {
  return HANDLERS[kind];
}

export function canStartAction(state: SimState, req: ActionRequest, ctx: SimContext): StartCheck {
  // The discriminant picks the handler, so the narrowing is sound.
  return actionHandler(req.kind).canStart(state, req, ctx);
}

/** Make `req` the current action (cycle progress reset). Caller has checked `canStartAction`. */
export function beginAction(state: SimState, req: ActionRequest, ctx: SimContext): SimState {
  const handler = actionHandler(req.kind);
  return {
    ...state,
    action: {
      ...state.action,
      current: {
        request: req,
        durationTicks: handler.durationTicks(state, req, ctx),
        elapsedTicks: 0,
        remaining: req.count,
      },
    },
  };
}

/**
 * Advance the active action by one tick. When a cycle completes: roll success (one float draw,
 * skipped when the chance is exactly 1), apply the outcome, then either restart the cycle or move
 * on to the queue. A cycle only restarts if the request can still start (crafting runs out of
 * inputs; a level can never drop, but the check is the handler's to make). Tick numbers are not
 * touched here; `stepTick` owns that.
 */
export function tickAction(state: SimState, ctx: SimContext): SimState {
  const before = state.action.current;
  if (before === null) return state;
  const handler = actionHandler(before.request.kind);
  const req = before.request as never;
  let s = state;
  if (handler.tick) {
    s = handler.tick(s, req, ctx);
    // The hook may have ended the action (a death); the queue is already what it wants.
    if (s.action.current === null) return s;
  }
  const cur = s.action.current!;
  const elapsed = cur.elapsedTicks + 1;
  if (elapsed < cur.durationTicks) {
    return { ...s, action: { ...s.action, current: { ...cur, elapsedTicks: elapsed } } };
  }

  const chance = handler.successChance(s, req, ctx);
  let success = true;
  if (chance < 1) {
    const [f, rng] = nextFloat(s.rng);
    success = f < chance;
    s = { ...s, rng };
  }
  const skill = skillOfRequest(cur.request, s, ctx);
  let after = handler.resolve(s, req, success, ctx);
  // A fight's cycle is one swing; combat's finds roll per kill instead, inside kill().
  if (success && cur.request.kind !== 'combat') after = rollFinds(after, skill, ctx);
  s = logLevelUps(s, after, ctx);
  s = countAction(s, skill);

  const remaining = cur.remaining === null ? null : cur.remaining - 1;
  if (remaining !== 0) {
    const again = handler.canStart(s, req, ctx);
    if (again.ok) {
      const restart = beginAction(s, cur.request, ctx);
      return {
        ...restart,
        action: { ...restart.action, current: { ...restart.action.current!, remaining } },
      };
    }
    s = pushEvent(s, {
      type: 'stopped',
      tick: s.tick,
      skill,
      reason: again.reason,
      fight: cur.request.kind === 'combat',
    });
  }
  return startNextQueued({ ...s, action: { ...s.action, current: null } }, ctx);
}

/** The skill a request trains. A fight's is the worn weapon's to say, so it needs the save. */
export function skillOfRequest(req: ActionRequest, state: SimState, ctx: SimContext): string {
  switch (req.kind) {
    case 'mining':
      return 'mining';
    case 'woodcutting':
      return 'woodcutting';
    case 'fishing':
      return 'fishing';
    case 'foraging':
      return 'foraging';
    case 'crafting':
      return ctx.content.recipe(req.recipe).skill;
    case 'combat':
      return combatStyle(state, ctx).skill;
  }
}

function countAction(state: SimState, skill: string): SimState {
  const actions = { ...state.stats.actions, [skill]: (state.stats.actions[skill] ?? 0) + 1 };
  return { ...state, stats: { ...state.stats, actions } };
}

/** Compare skill levels before and after a resolve and log every level gained. */
function logLevelUps(before: SimState, after: SimState, ctx: SimContext): SimState {
  if (before.skills === after.skills) return after;
  let s = after;
  for (const skill of Object.keys(after.skills)) {
    const from = ctx.xp.levelForXp(before.skills[skill]?.xp ?? 0);
    const to = ctx.xp.levelForXp(after.skills[skill]?.xp ?? 0);
    if (to > from) s = pushEvent(s, { type: 'level', tick: s.tick, skill, from, to });
  }
  return s;
}

/** Pop queued requests until one can start; requests that can no longer start are dropped. */
export function startNextQueued(state: SimState, ctx: SimContext): SimState {
  let queue = state.action.queue;
  while (queue.length > 0) {
    const [next, ...rest] = queue;
    queue = rest;
    if (next && canStartAction(state, next, ctx).ok) {
      return beginAction({ ...state, action: { current: null, queue } }, next, ctx);
    }
  }
  return { ...state, action: { current: null, queue } };
}
