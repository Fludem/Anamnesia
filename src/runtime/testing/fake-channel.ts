import type { ChannelLike } from '../env.ts';

/**
 * In-memory BroadcastChannel: every endpoint opened on the same hub+name receives messages
 * posted by the others (never its own), delivered asynchronously like the real thing.
 */
export class FakeChannelHub {
  private endpoints = new Map<string, Set<FakeChannel>>();
  readonly sent: Array<{ name: string; data: unknown }> = [];

  open(name: string): ChannelLike {
    const set = this.endpoints.get(name) ?? new Set();
    this.endpoints.set(name, set);
    const ch = new FakeChannel(name, this, set);
    set.add(ch);
    return ch;
  }
}

class FakeChannel implements ChannelLike {
  private listeners = new Set<(data: unknown) => void>();
  private closed = false;

  constructor(
    private readonly name: string,
    private readonly hub: FakeChannelHub,
    private readonly peers: Set<FakeChannel>,
  ) {}

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('channel closed');
    this.hub.sent.push({ name: this.name, data: message });
    const data = structuredClone(message);
    for (const peer of this.peers) {
      if (peer === this || peer.closed) continue;
      queueMicrotask(() => {
        if (!peer.closed) for (const l of peer.listeners) l(structuredClone(data));
      });
    }
  }

  subscribe(listener: (data: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.peers.delete(this);
    this.listeners.clear();
  }
}
