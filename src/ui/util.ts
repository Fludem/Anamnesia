/** Non-component helpers the UI shares (kept out of component files for fast refresh). */
import { useEffect, useState } from 'react';
import { icons } from '../icons/registry.ts';
import type { IconSpec } from '../icons/render.ts';

/** A monochrome UI icon that takes its colour from CSS `color`. */
export function uiIcon(id: string): IconSpec {
  const e = icons.get(id);
  return { layers: [{ id: e.id, d: e.d, fill: { kind: 'flat', color: 'currentColor' } }] };
}

/** Wall-clock "now", refreshed every `everyMs`. Only for session timers — never for the sim. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(h);
  }, [everyMs]);
  return now;
}

/** Deterministic horizontal offset (px from the right) for a floating pop, from its tick. */
export const popX = (tick: number): number => 14 + ((tick * 37) % 60);
