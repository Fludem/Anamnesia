import { planAdvance, planTickCount } from '../sim/advance.ts';
import { OFFLINE_CAP_TICKS, TICK_MS } from '../sim/constants.ts';
import { migrateSave, SaveLoadError } from '../sim/migrate.ts';
import {
  createNewSave,
  CURRENT_SAVE_VERSION,
  type SaveRecord,
  type SimState,
} from '../sim/save.ts';
import { stepTick, type StepFn } from '../sim/step.ts';
import { CHANNEL_NAME, GameChannel, type GameAction } from './channel.ts';
import { DEFAULT_BATCH_TICKS, runAdvance } from './catch-up.ts';
import type { Env } from './env.ts';
import { LeaderElection, LOCK_NAME } from './leader.ts';

export type HostRole = 'booting' | 'follower' | 'leader' | 'handing-over' | 'stale' | 'error';

export interface CatchUpProgress {
  done: number;
  total: number;
}

export interface CappedNotice {
  /** Ticks that elapsed beyond the cap and were discarded. */
  skippedTicks: number;
  /** Total wall time the player was away (including the capped part). */
  awayMs: number;
  capMs: number;
}

/** Immutable view of the host for rendering. A new object is produced on every change. */
export interface HostSnapshot {
  role: HostRole;
  tabId: string;
  leaderId: string | null;
  sim: SimState | null;
  wallMs: number | null;
  saveCounter: number;
  lastSavedAtMs: number | null;
  catchUp: CatchUpProgress | null;
  cappedNotice: CappedNotice | null;
  takeoverPending: boolean;
  /** Non-fatal condition the UI should show (e.g. guard-only mode). */
  warning: string | null;
  /** Fatal condition; the host has stopped. */
  error: string | null;
}

export interface GameHostOptions {
  slot?: string;
  step?: StepFn;
  tickMs?: number;
  capTicks?: number;
  batchTicks?: number;
  /** Periodic save while leading. */
  saveIntervalMs?: number;
  /** Minimum gap between broadcast snapshots while ticking. */
  snapshotIntervalMs?: number;
  /** How long a follower waits for takeover-ack before stealing anyway. */
  takeoverAckTimeoutMs?: number;
  /** How long a leader stays in handing-over before resuming if nobody steals. */
  handoverResumeMs?: number;
  /** How long after boot without a lock grant or a snapshot before we report 'follower'. */
  followerSettleMs?: number;
  /** Called on the leader for every action (local or forwarded). Phase 1 feeds the action queue. */
  onAction?: (action: GameAction, fromTabId: string) => void;
}

type SaveReason = 'claim' | 'catch-up' | 'periodic' | 'hidden' | 'pagehide' | 'handover' | 'manual';

/**
 * Exactly one tab runs the sim. This host decides which role this tab plays and enforces the
 * single-writer rules: load/catch-up only after the lock, every write guarded by the save
 * counter, ticks derived from the clock, and a visible follower state instead of silent
 * divergence.
 */
export class GameHost {
  private readonly opts: Required<Omit<GameHostOptions, 'onAction'>> & {
    onAction: GameHostOptions['onAction'] | undefined;
  };
  private readonly channel: GameChannel;
  private readonly election: LeaderElection | null;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];

  private snapshot: HostSnapshot;
  private sim: SimState | null = null;
  private wallMs: number | null = null;
  /** The counter we last loaded or wrote; the only counter the store will accept from us. */
  private saveCounter = 0;

  private session: AbortController | null = null;
  private advancing = false;
  private saveChain: Promise<void> = Promise.resolve();
  private tickHandle: unknown = null;
  private saveHandle: unknown = null;
  private handoverHandle: unknown = null;
  private takeoverHandle: unknown = null;
  private settleHandle: unknown = null;
  private lastBroadcastMs = Number.NEGATIVE_INFINITY;
  private started = false;
  private stopped = false;

  constructor(
    private readonly env: Env,
    options: GameHostOptions = {},
  ) {
    this.opts = {
      slot: options.slot ?? 'main',
      step: options.step ?? stepTick,
      tickMs: options.tickMs ?? TICK_MS,
      capTicks: options.capTicks ?? OFFLINE_CAP_TICKS,
      batchTicks: options.batchTicks ?? DEFAULT_BATCH_TICKS,
      saveIntervalMs: options.saveIntervalMs ?? 10_000,
      snapshotIntervalMs: options.snapshotIntervalMs ?? 250,
      takeoverAckTimeoutMs: options.takeoverAckTimeoutMs ?? 2_000,
      handoverResumeMs: options.handoverResumeMs ?? 3_000,
      followerSettleMs: options.followerSettleMs ?? 300,
      onAction: options.onAction,
    };
    this.channel = new GameChannel(env.openChannel(CHANNEL_NAME));
    this.election = env.locks ? new LeaderElection(env.locks, LOCK_NAME) : null;
    this.snapshot = {
      role: 'booting',
      tabId: env.tabId,
      leaderId: null,
      sim: null,
      wallMs: null,
      saveCounter: 0,
      lastSavedAtMs: null,
      catchUp: null,
      cappedNotice: null,
      takeoverPending: false,
      warning: null,
      error: null,
    };
  }

  // ---- public API -------------------------------------------------------------------------

  getSnapshot(): HostSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get role(): HostRole {
    return this.snapshot.role;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.cleanups.push(this.channel.on('hello', () => this.onHello()));
    this.cleanups.push(this.channel.on('snapshot', (m) => this.onSnapshot(m)));
    this.cleanups.push(this.channel.on('action', (m) => this.onRemoteAction(m.action, m.tabId)));
    this.cleanups.push(this.channel.on('takeover-request', (m) => this.onTakeoverRequest(m.tabId)));
    this.cleanups.push(this.channel.on('takeover-ack', (m) => this.onTakeoverAck(m.to)));
    this.cleanups.push(this.env.lifecycle.onHidden(() => void this.save('hidden')));
    this.cleanups.push(this.env.lifecycle.onPageHide(() => this.onPageHide()));
    this.cleanups.push(
      this.env.lifecycle.onPageShow((persisted) => {
        if (persisted) this.env.reloadPage();
      }),
    );

    this.channel.post({ type: 'hello', tabId: this.env.tabId });

    if (!this.election) {
      this.patch({
        warning:
          'Web Locks is unavailable (insecure context). Running without tab coordination; ' +
          'opening a second tab may cause reloads.',
      });
      void this.becomeLeader();
      return;
    }
    this.election.onLost(() => this.onLost());
    this.queueForLeadership();
    this.settleHandle = this.env.scheduler.setTimeout(() => {
      if (this.role === 'booting') this.patch({ role: 'follower' });
    }, this.opts.followerSettleMs);
  }

  /** Ask the current leader to hand over, then take the lock. */
  takeOver(): void {
    if (!this.election || this.role === 'leader' || this.snapshot.takeoverPending) return;
    this.patch({ takeoverPending: true });
    this.channel.post({ type: 'takeover-request', tabId: this.env.tabId });
    this.takeoverHandle = this.env.scheduler.setTimeout(
      () => this.steal(),
      this.opts.takeoverAckTimeoutMs,
    );
  }

  /** Apply a player intent. Leaders handle it; everyone else forwards it to the leader. */
  dispatch(action: GameAction): void {
    if (this.role === 'leader' || this.role === 'handing-over') {
      this.opts.onAction?.(action, this.env.tabId);
    } else {
      this.channel.post({ type: 'action', tabId: this.env.tabId, action });
    }
  }

  saveNow(): Promise<void> {
    return this.save('manual');
  }

  dismissCappedNotice(): void {
    this.patch({ cappedNotice: null });
  }

  /** Tear down timers, listeners and the channel. Releases the lock if held. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopLeading();
    this.election?.cancel();
    this.election?.release();
    for (const c of this.cleanups) c();
    for (const h of [this.takeoverHandle, this.settleHandle])
      if (h != null) this.env.scheduler.clearTimeout(h);
    this.channel.close();
  }

  // ---- election ---------------------------------------------------------------------------

  private queueForLeadership(): void {
    if (!this.election || this.stopped) return;
    this.election.acquire().then(
      () => void this.becomeLeader(),
      () => {
        /* cancelled by stop() */
      },
    );
  }

  private steal(): void {
    if (!this.election || this.stopped || this.role === 'leader') return;
    this.clearTakeoverTimer();
    // We are queued with a plain request; leave the queue, then steal.
    this.election.cancel();
    const attempt = () => {
      if (!this.election || this.stopped) return;
      if (this.election.electionState !== 'idle') {
        this.env.scheduler.setTimeout(attempt, 0);
        return;
      }
      this.election.acquire({ steal: true }).then(
        () => void this.becomeLeader(),
        () => this.queueForLeadership(),
      );
    };
    attempt();
  }

  private onLost(): void {
    if (this.stopped) return;
    this.stopLeading();
    this.patch({ role: 'follower', leaderId: null, takeoverPending: false, catchUp: null });
    this.queueForLeadership();
  }

  // ---- leading ----------------------------------------------------------------------------

  private async becomeLeader(): Promise<void> {
    if (this.stopped) return;
    if (this.settleHandle != null) this.env.scheduler.clearTimeout(this.settleHandle);
    this.clearTakeoverTimer();
    const session = new AbortController();
    this.session = session;
    this.patch({ role: 'leader', leaderId: this.env.tabId, takeoverPending: false, error: null });

    // 1. Load — only now, with the lock held.
    let record: SaveRecord;
    try {
      const raw = await this.env.store.load(this.opts.slot);
      if (session.signal.aborted) return;
      record =
        raw === null
          ? createNewSave({
              seed: this.env.randomSeed(),
              nowMs: this.env.clock.now(),
              writerId: this.env.tabId,
            })
          : migrateSave(raw);
    } catch (e) {
      this.fail(
        e instanceof SaveLoadError
          ? `Save could not be loaded: ${e.message}`
          : `Storage error: ${String(e)}`,
      );
      return;
    }
    this.sim = record.sim;
    this.wallMs = record.wallMs;
    this.saveCounter = record.saveCounter;
    this.patch({ sim: this.sim, wallMs: this.wallMs, saveCounter: this.saveCounter });

    // 2. Claim the slot before doing any work, so a straggler write from the previous leader
    //    is the one that gets rejected.
    await this.save('claim');
    if (session.signal.aborted || this.role !== 'leader') return;

    // 3. Offline catch-up through the same path as live ticks.
    const before = this.wallMs;
    await this.advanceToNow(session);
    if (session.signal.aborted || this.role !== 'leader') return;
    if (this.wallMs !== null && this.wallMs - before > 0) await this.save('catch-up');
    if (session.signal.aborted || this.role !== 'leader') return;

    // 4. Live loop. The interval is a wake-up only; ticks are derived from the clock each fire.
    this.tickHandle = this.env.scheduler.setInterval(() => void this.onTimer(), this.opts.tickMs);
    this.saveHandle = this.env.scheduler.setInterval(
      () => void this.save('periodic'),
      this.opts.saveIntervalMs,
    );
    this.broadcastSnapshot(true);
  }

  private async onTimer(): Promise<void> {
    if (this.role !== 'leader' || !this.session) return;
    await this.advanceToNow(this.session);
  }

  /** Plan from the clock and run exactly the derived ticks. Re-entrant calls are dropped. */
  private async advanceToNow(session: AbortController): Promise<void> {
    if (this.advancing || this.sim === null || this.wallMs === null) return;
    const plan = planAdvance({
      tick: this.sim.tick,
      wallMs: this.wallMs,
      nowMs: this.env.clock.now(),
      tickMs: this.opts.tickMs,
      capTicks: this.opts.capTicks,
    });
    const count = planTickCount(plan);
    if (count === 0) {
      if (plan.clockWentBackwards) {
        this.wallMs = plan.newWallMs;
        this.patch({ wallMs: this.wallMs });
      }
      return;
    }
    if (plan.skippedTicks > 0) {
      this.patch({
        cappedNotice: {
          skippedTicks: plan.skippedTicks,
          awayMs: plan.newWallMs - plan.fromWallMs,
          capMs: this.opts.capTicks * this.opts.tickMs,
        },
      });
    }

    this.advancing = true;
    const showProgress = count > this.opts.batchTicks;
    if (showProgress) this.patch({ catchUp: { done: 0, total: count } });
    try {
      const batchTicks = this.env.lifecycle.isHidden()
        ? this.opts.batchTicks * 5
        : this.opts.batchTicks;
      await runAdvance(this.sim, plan, this.opts.step, {
        batchTicks,
        yieldToEventLoop: () => this.env.yieldToEventLoop(),
        signal: session.signal,
        onBatch: ({ sim, wallMs, done, total }) => {
          if (session.signal.aborted) return;
          // Commit state and anchor together: a save at any point is consistent.
          this.sim = sim;
          this.wallMs = wallMs;
          this.patch({ sim, wallMs, catchUp: showProgress ? { done, total } : null });
          this.broadcastSnapshot(false);
        },
      });
    } finally {
      this.advancing = false;
      if (showProgress && !session.signal.aborted) this.patch({ catchUp: null });
    }
  }

  private stopLeading(): void {
    this.session?.abort();
    this.session = null;
    this.advancing = false;
    if (this.tickHandle != null) this.env.scheduler.clearInterval(this.tickHandle);
    if (this.saveHandle != null) this.env.scheduler.clearInterval(this.saveHandle);
    if (this.handoverHandle != null) this.env.scheduler.clearTimeout(this.handoverHandle);
    this.tickHandle = this.saveHandle = this.handoverHandle = null;
  }

  // ---- saving -----------------------------------------------------------------------------

  /** Guarded write. Serialised so two triggers never race each other within this tab. */
  private save(reason: SaveReason): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.stopped && reason !== 'pagehide') return;
      if (this.role !== 'leader' && this.role !== 'handing-over') return;
      if (this.sim === null || this.wallMs === null) return;
      const record: SaveRecord = {
        version: CURRENT_SAVE_VERSION,
        saveCounter: this.saveCounter,
        writerId: this.env.tabId,
        wallMs: this.wallMs,
        sim: this.sim,
      };
      let result;
      try {
        result = await this.env.store.write(this.opts.slot, record, this.saveCounter);
      } catch (e) {
        this.fail(`Storage error while saving: ${String(e)}`);
        return;
      }
      if (!result.ok) {
        this.becomeStale();
        return;
      }
      this.saveCounter = result.saveCounter;
      this.patch({ saveCounter: this.saveCounter, lastSavedAtMs: this.env.clock.now() });
      this.broadcastSnapshot(true);
    };
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  /** Someone else wrote after us: the lock failed or we woke from a frozen state. Never overwrite. */
  private becomeStale(): void {
    this.stopLeading();
    this.election?.release();
    this.patch({ role: 'stale', leaderId: null });
    this.env.reloadPage();
  }

  private fail(message: string): void {
    this.stopLeading();
    this.patch({ role: 'error', error: message });
  }

  // ---- lifecycle --------------------------------------------------------------------------

  private onPageHide(): void {
    if (this.role !== 'leader' && this.role !== 'handing-over') return;
    // Flush, then give the lock up deterministically rather than relying on bfcache rules.
    void this.save('pagehide').then(() => {
      this.stopLeading();
      this.election?.release();
      this.patch({ role: 'stale' });
    });
  }

  // ---- channel ----------------------------------------------------------------------------

  private onHello(): void {
    if (this.role === 'leader' || this.role === 'handing-over') this.broadcastSnapshot(true);
  }

  private onSnapshot(m: {
    leaderId: string;
    saveCounter: number;
    wallMs: number;
    sim: SimState;
  }): void {
    if (
      this.role === 'leader' ||
      this.role === 'handing-over' ||
      this.role === 'stale' ||
      this.role === 'error'
    ) {
      return;
    }
    if (this.settleHandle != null) this.env.scheduler.clearTimeout(this.settleHandle);
    this.patch({
      role: 'follower',
      leaderId: m.leaderId,
      sim: m.sim,
      wallMs: m.wallMs,
      saveCounter: m.saveCounter,
    });
  }

  private onRemoteAction(action: GameAction, fromTabId: string): void {
    if (this.role !== 'leader') return;
    this.opts.onAction?.(action, fromTabId);
  }

  private onTakeoverRequest(requester: string): void {
    if (this.role !== 'leader' && this.role !== 'handing-over') return;
    if (this.role === 'leader') {
      // Stop ticking and periodic saves but KEEP the lock, so no queued tab can be promoted
      // in the gap. Resume if nobody steals within the grace period.
      this.session?.abort();
      this.session = null;
      this.advancing = false;
      if (this.tickHandle != null) this.env.scheduler.clearInterval(this.tickHandle);
      if (this.saveHandle != null) this.env.scheduler.clearInterval(this.saveHandle);
      this.tickHandle = this.saveHandle = null;
      this.patch({ role: 'handing-over', catchUp: null });
      this.handoverHandle = this.env.scheduler.setTimeout(
        () => this.resumeLeading(),
        this.opts.handoverResumeMs,
      );
    }
    void this.save('handover').then(() => {
      if (this.role !== 'handing-over') return;
      this.channel.post({ type: 'takeover-ack', to: requester, saveCounter: this.saveCounter });
    });
  }

  private resumeLeading(): void {
    if (this.role !== 'handing-over' || this.stopped) return;
    this.handoverHandle = null;
    void this.becomeLeader();
  }

  private onTakeoverAck(to: string): void {
    if (to !== this.env.tabId || !this.snapshot.takeoverPending) return;
    this.steal();
  }

  private broadcastSnapshot(force: boolean): void {
    if (this.sim === null || this.wallMs === null) return;
    const now = this.env.clock.now();
    if (!force && now - this.lastBroadcastMs < this.opts.snapshotIntervalMs) return;
    this.lastBroadcastMs = now;
    this.channel.post({
      type: 'snapshot',
      leaderId: this.env.tabId,
      saveCounter: this.saveCounter,
      wallMs: this.wallMs,
      sim: this.sim,
    });
  }

  // ---- state ------------------------------------------------------------------------------

  private clearTakeoverTimer(): void {
    if (this.takeoverHandle != null) this.env.scheduler.clearTimeout(this.takeoverHandle);
    this.takeoverHandle = null;
  }

  private patch(changes: Partial<HostSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const l of this.listeners) l();
  }
}
