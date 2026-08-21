import type { HostSnapshot } from '../runtime/game-host.ts';
import { formatDuration, formatInt } from './format.ts';

export function FollowerBanner({
  snapshot,
  onTakeOver,
}: {
  snapshot: HostSnapshot;
  onTakeOver: () => void;
}) {
  const waiting = snapshot.takeoverPending;
  return (
    <div className="banner" role="status">
      <div className="grow">
        <div className="title">This game is running in another tab.</div>
        <div className="detail">
          {snapshot.sim
            ? 'You are watching a live mirror. Nothing here ticks or saves until you take over.'
            : 'Waiting for the active tab to share its state…'}
        </div>
      </div>
      <button className="primary" onClick={onTakeOver} disabled={waiting}>
        {waiting ? 'Taking over…' : 'Take over here'}
      </button>
    </div>
  );
}

export function CatchUpProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 100;
  return (
    <div
      className="banner"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className="grow">
        <div className="title">Catching up on time away…</div>
        <div className="detail">
          {formatInt(done)} / {formatInt(total)} ticks ({formatDuration(done * 100)} of{' '}
          {formatDuration(total * 100)})
        </div>
        <div className="progress">
          <div style={{ width: `${String(pct)}%` }} />
        </div>
      </div>
    </div>
  );
}

export function CappedNotice({
  notice,
  onDismiss,
}: {
  notice: NonNullable<HostSnapshot['cappedNotice']>;
  onDismiss: () => void;
}) {
  return (
    <div className="banner warn" role="status">
      <div className="grow">
        <div className="title">Offline progress was capped.</div>
        <div className="detail">
          You were away for {formatDuration(notice.awayMs)}; progress is capped at{' '}
          {formatDuration(notice.capMs)}. {formatDuration(notice.skippedTicks * 100)} was not
          counted.
        </div>
      </div>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

export function StaleBanner() {
  return (
    <div className="banner warn" role="alert">
      <div className="grow">
        <div className="title">This tab is out of date.</div>
        <div className="detail">
          Another tab saved more recently. Reloading to pick up the latest state…
        </div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner error" role="alert">
      <div className="grow">
        <div className="title">The game could not start.</div>
        <div className="detail">{message}</div>
      </div>
    </div>
  );
}

export function WarningBanner({ message }: { message: string }) {
  return (
    <div className="banner warn" role="status">
      <div className="grow">
        <div className="detail">{message}</div>
      </div>
    </div>
  );
}
