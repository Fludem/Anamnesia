import { TICK_MS } from '../sim/constants.ts';

/** "4h 12m" / "12m 05s" / "38s". For elapsed and away times. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h)}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${String(m)}m ${String(s).padStart(2, '0')}s`;
  return `${String(s)}s`;
}

/** "2.2s" — action lengths, to a tenth, the way the design writes them. */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export const ticksToMs = (ticks: number): number => ticks * TICK_MS;

/** Thousands-separated integer. */
export const formatInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Bank-cell quantities: full up to 9,999, then "12k". */
export function formatShort(n: number): string {
  return n >= 10_000 ? `${String(Math.floor(n / 1000))}k` : formatInt(n);
}

/** "12s" / "3m" — how long ago, for the drop feed. */
export function formatAge(ms: number): string {
  if (ms < 60_000) return `${String(Math.max(0, Math.floor(ms / 1000)))}s`;
  if (ms < 3_600_000) return `${String(Math.floor(ms / 60_000))}m`;
  return `${String(Math.floor(ms / 3_600_000))}h`;
}

/** "−10%" / "+1" with a real minus sign. */
export function formatSigned(n: number, suffix = ''): string {
  return `${n < 0 ? '−' : '+'}${String(Math.abs(n))}${suffix}`;
}
