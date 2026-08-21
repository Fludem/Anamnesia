import { z } from 'zod';
import { ActionRequestSchema, beginAction, canStartAction, startNextQueued } from './actions.ts';
import type { SimContext } from './context.ts';
import type { SimState } from './save.ts';

/**
 * Player intents. Applied by the leader between ticks; followers send them over the channel.
 * Pure: a command either produces a new state or is rejected with a reason, never a throw.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  /** Replace whatever is running (and the queue) with this request. */
  z.object({ type: z.literal('action:start'), request: ActionRequestSchema }),
  /** Run after the current action finishes its count; starts immediately if idle. */
  z.object({ type: z.literal('action:enqueue'), request: ActionRequestSchema }),
  /** Stop the current action and clear the queue. */
  z.object({ type: z.literal('action:stop') }),
]);
export type Command = z.infer<typeof CommandSchema>;

export type CommandResult =
  { ok: true; state: SimState } | { ok: false; state: SimState; reason: string };

export function applyCommand(state: SimState, cmd: Command, ctx: SimContext): CommandResult {
  switch (cmd.type) {
    case 'action:start': {
      const check = canStartAction(state, cmd.request, ctx);
      if (!check.ok) return { ok: false, state, reason: check.reason };
      return {
        ok: true,
        state: beginAction({ ...state, action: { current: null, queue: [] } }, cmd.request, ctx),
      };
    }
    case 'action:enqueue': {
      const check = canStartAction(state, cmd.request, ctx);
      if (!check.ok) return { ok: false, state, reason: check.reason };
      const queued = {
        ...state,
        action: { ...state.action, queue: [...state.action.queue, cmd.request] },
      };
      return { ok: true, state: queued.action.current ? queued : startNextQueued(queued, ctx) };
    }
    case 'action:stop':
      return { ok: true, state: { ...state, action: { current: null, queue: [] } } };
  }
}
