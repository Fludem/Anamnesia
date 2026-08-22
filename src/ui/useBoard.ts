/**
 * One board from the register, kept fresh: fetched when the board changes or this tab's save
 * lands (the hero's own row moves then), and every half minute for everyone else's.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { Board } from '../api/protocol.ts';

export const BOARD_REFRESH_MS = 30_000;

export interface BoardState {
  /** The last board read; stays while a newer one loads. */
  board: Board | null;
  /** Why the last read failed, or null. */
  error: string | null;
  loading: boolean;
}

export function useBoard(id: string, savedAtMs: number | null): BoardState {
  const [state, setState] = useState<BoardState>({ board: null, error: null, loading: true });

  useEffect(() => {
    let live = true;
    const read = () => {
      setState((s) => ({ ...s, loading: true }));
      api.board(id).then(
        (board) => {
          if (live) setState({ board, error: null, loading: false });
        },
        (e: unknown) => {
          if (!live) return;
          const error = e instanceof ApiError ? e.message : String(e);
          setState((s) => ({
            board: s.board?.board === id ? s.board : null,
            error,
            loading: false,
          }));
        },
      );
    };
    read();
    const timer = setInterval(read, BOARD_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, savedAtMs]);

  return state;
}
