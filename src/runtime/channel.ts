import { z } from 'zod';
import { CommandSchema, type Command } from '../sim/commands.ts';
import { SimStateSchema } from '../sim/save.ts';
import type { ChannelLike } from './env.ts';

export const CHANNEL_NAME = 'anamnesia:game';

/** Player intents are the sim's commands; the channel just carries them to the leader. */
export const GameActionSchema = CommandSchema;
export type GameAction = Command;

export const ChannelMessageSchema = z.discriminatedUnion('type', [
  /** A tab has opened and wants the current state. */
  z.object({ type: z.literal('hello'), tabId: z.string() }),
  /** Leader → all: authoritative state. Followers render exactly this. */
  z.object({
    type: z.literal('snapshot'),
    leaderId: z.string(),
    saveCounter: z.number().int(),
    wallMs: z.number(),
    sim: SimStateSchema,
  }),
  /** Follower → leader: a player intent to apply. */
  z.object({ type: z.literal('action'), tabId: z.string(), action: GameActionSchema }),
  /** Follower → leader: I want to become leader; please flush and acknowledge. */
  z.object({ type: z.literal('takeover-request'), tabId: z.string() }),
  /** Leader → requester: flushed; steal the lock now. */
  z.object({ type: z.literal('takeover-ack'), to: z.string(), saveCounter: z.number().int() }),
]);
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;
export type MessageOf<T extends ChannelMessage['type']> = Extract<ChannelMessage, { type: T }>;

/** Typed, validated wrapper over a BroadcastChannel-like endpoint. Malformed messages are dropped. */
export class GameChannel {
  private readonly unsubscribe: () => void;
  private readonly handlers = new Map<ChannelMessage['type'], Set<(m: ChannelMessage) => void>>();

  constructor(private readonly raw: ChannelLike) {
    this.unsubscribe = raw.subscribe((data) => {
      const parsed = ChannelMessageSchema.safeParse(data);
      if (!parsed.success) return;
      const msg = parsed.data;
      for (const h of this.handlers.get(msg.type) ?? []) h(msg);
    });
  }

  post(message: ChannelMessage): void {
    this.raw.postMessage(message);
  }

  on<T extends ChannelMessage['type']>(type: T, handler: (m: MessageOf<T>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set();
    this.handlers.set(type, set);
    // Handlers are registered per discriminant, so the narrowing is sound.
    const h = handler as (m: ChannelMessage) => void;
    set.add(h);
    return () => set.delete(h);
  }

  close(): void {
    this.unsubscribe();
    this.handlers.clear();
    this.raw.close();
  }
}
