/**
 * The table from the register, kept fresh: read when this tab's save lands (what the wheel
 * owes comes home then), and every couple of seconds while the screen is open, since the other names'
 * chips and the pocket arrive on the register's clock, not this tab's. `offsetMs` is how far
 * that clock is from this one, so the countdown is the register's. Every change made from the
 * screen goes through `act`, which shows the register's answer and keeps its reason when it
 * said no.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { WheelGet } from '../api/protocol.ts';

export const WHEEL_REFRESH_MS = 2_000;

export interface WheelState {
  /** The last answer; stays while a newer one loads. */
  data: WheelGet | null;
  /** The register's clock minus this one's, from the last answer. */
  offsetMs: number;
  /** Why the last read or change failed, or null. */
  error: string | null;
  /** Run a change and show what the register answered; resolves to the refusal, or null. */
  act: (change: () => Promise<WheelGet>) => Promise<string | null>;
}

const reason = (e: unknown): string => (e instanceof ApiError ? e.message : String(e));

export function useWheel(savedAtMs: number | null): WheelState {
  const [data, setData] = useState<WheelGet | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      const asked = Date.now();
      api.wheel().then(
        (got) => {
          if (!live) return;
          setData(got);
          setOffsetMs(got.now - (asked + Date.now()) / 2);
          setError(null);
        },
        (e: unknown) => {
          if (!live) return;
          setError(reason(e));
        },
      );
    };
    read();
    const timer = setInterval(read, WHEEL_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [savedAtMs]);

  const act = useCallback(async (change: () => Promise<WheelGet>): Promise<string | null> => {
    try {
      const asked = Date.now();
      const got = await change();
      setData(got);
      setOffsetMs(got.now - (asked + Date.now()) / 2);
      setError(null);
      return null;
    } catch (e) {
      const why = reason(e);
      setError(why);
      return why;
    }
  }, []);

  return { data, offsetMs, error, act };
}
