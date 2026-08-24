/**
 * The ring from the register, kept fresh: read when this tab's save lands (a settlement is
 * taken then) and every half minute, for who has stepped in and whose rest has run out.
 * A call goes through `call`, which shows the bout the register fought and keeps its reason
 * when it refused.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { RingCalled, RingCard, RingGet } from '../api/protocol.ts';

export const RING_REFRESH_MS = 30_000;

export interface RingState {
  /** The last answer; stays while a newer one loads. */
  data: RingGet | null;
  error: string | null;
  loading: boolean;
  /** The bout just fought, for the card to replay; cleared by `forget`. */
  fought: RingCalled | null;
  forget: () => void;
  /** What a name is wearing. Resolves to the refusal instead when the register said no. */
  card: (name: string) => Promise<RingCard | string>;
  /** Call a name out for one of their things. Resolves to the refusal, or null. */
  call: (name: string, item: string) => Promise<string | null>;
  refresh: () => void;
}

const reason = (e: unknown): string => (e instanceof ApiError ? e.message : String(e));

export function useRing(savedAtMs: number | null): RingState {
  const [data, setData] = useState<RingGet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fought, setFought] = useState<RingCalled | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    const read = () => {
      setLoading(true);
      api.ring().then(
        (got) => {
          if (!live) return;
          setData(got);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          if (!live) return;
          setError(reason(e));
          setLoading(false);
        },
      );
    };
    read();
    const timer = setInterval(read, RING_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [savedAtMs, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const card = useCallback(async (name: string): Promise<RingCard | string> => {
    try {
      return await api.ringCard(name);
    } catch (e) {
      return reason(e);
    }
  }, []);

  const call = useCallback(async (name: string, item: string): Promise<string | null> => {
    try {
      const got = await api.ringCall(name, item);
      setFought(got);
      // The bout is settled on this name's next save, so ask the register again straight away
      // for the clocks; the settlement itself arrives with the save, not here.
      api.ring().then(setData, () => undefined);
      return null;
    } catch (e) {
      return reason(e);
    }
  }, []);

  const forget = useCallback(() => {
    setFought(null);
  }, []);

  return { data, error, loading, fought, forget, card, call, refresh };
}
