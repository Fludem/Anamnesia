export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h)}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${String(m)}m ${String(s).padStart(2, '0')}s`;
  return `${String(s)}s`;
}

export const formatInt = (n: number): string => n.toLocaleString('en-GB');
