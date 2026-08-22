/**
 * Who is logged in. Asks the register once on mount, then follows the login, register and
 * logout calls. Logging out is the caller's to sequence (the game must save and stop first),
 * so `signOut` only tells the register and forgets the user.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { Credentials, User } from '../api/protocol.ts';

export type SessionState =
  { kind: 'checking' } | { kind: 'out'; error: string | null } | { kind: 'in'; user: User };

export interface SessionHandle {
  session: SessionState;
  /** Registers or logs in; resolves to null on success, or the reason it did not work. */
  register: (creds: Credentials) => Promise<string | null>;
  login: (creds: Credentials) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const reason = (e: unknown): string =>
  e instanceof ApiError ? e.message : `Something went wrong (${String(e)}).`;

export function useSession(): SessionHandle {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });

  useEffect(() => {
    let live = true;
    api.me().then(
      (s) => {
        if (!live) return;
        setSession(s.user ? { kind: 'in', user: s.user } : { kind: 'out', error: null });
      },
      (e: unknown) => {
        if (live) setSession({ kind: 'out', error: reason(e) });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const enter = useCallback(async (go: Promise<{ user: User | null }>): Promise<string | null> => {
    try {
      const s = await go;
      if (!s.user) return 'The register let nobody in.';
      setSession({ kind: 'in', user: s.user });
      return null;
    } catch (e) {
      return reason(e);
    }
  }, []);

  const register = useCallback((creds: Credentials) => enter(api.register(creds)), [enter]);
  const login = useCallback((creds: Credentials) => enter(api.login(creds)), [enter]);
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession({ kind: 'out', error: null });
    }
  }, []);

  return { session, register, login, signOut };
}
