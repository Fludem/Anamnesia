/**
 * The caller's hall from the register, kept fresh: read when this tab's save lands (a gift
 * is taken then) and every half minute for what the other names did. Every change made from
 * the screen goes through `act`, which shows the register's answer and keeps its reason when
 * it said no.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { HallGet, HallSummary } from '../api/protocol.ts';

export const HALL_REFRESH_MS = 30_000;

export interface HallState {
  /** The last answer; stays while a newer one loads. */
  data: HallGet | null;
  /** Every hall on the hill, read alongside while the caller has none. */
  halls: HallSummary[];
  /** Why the last read failed, or null. */
  error: string | null;
  loading: boolean;
  /** Run a change and show what the register answered; resolves to the refusal, or null. */
  act: (change: () => Promise<HallGet>) => Promise<string | null>;
}

const reason = (e: unknown): string => (e instanceof ApiError ? e.message : String(e));

export function useHall(savedAtMs: number | null): HallState {
  const [data, setData] = useState<HallGet | null>(null);
  const [halls, setHalls] = useState<HallSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const read = () => {
      setLoading(true);
      api.hall().then(
        (got) => {
          if (!live) return;
          setData(got);
          setError(null);
          setLoading(false);
          if (got.hall === null)
            api.halls().then(
              (list) => live && setHalls(list),
              () => undefined,
            );
        },
        (e: unknown) => {
          if (!live) return;
          setError(reason(e));
          setLoading(false);
        },
      );
    };
    read();
    const timer = setInterval(read, HALL_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [savedAtMs]);

  const act = useCallback(async (change: () => Promise<HallGet>): Promise<string | null> => {
    try {
      const got = await change();
      setData(got);
      setError(null);
      if (got.hall === null) setHalls(await api.halls());
      return null;
    } catch (e) {
      return reason(e);
    }
  }, []);

  return { data, halls, error, loading, act };
}
