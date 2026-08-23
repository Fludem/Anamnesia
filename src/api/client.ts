/**
 * The game's side of the wire: one function per route, each answer checked against the
 * protocol's schema. The save itself does not go through here — the host's store does that
 * (src/runtime/server-store.ts).
 */
import type { ZodType } from 'zod';
import {
  BoardSchema,
  HallGetSchema,
  HallsSchema,
  SessionSchema,
  type Board,
  type Credentials,
  type HallGet,
  type HallSummary,
  type Session,
} from './protocol.ts';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(
  method: string,
  path: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, `Could not reach the hill's register (${String(e)}).`);
  }
  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    /* no body, or not JSON */
  }
  if (!res.ok) {
    const message =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { error?: unknown }).error === 'string'
        ? (raw as { error: string }).error
        : `The register answered ${String(res.status)}.`;
    throw new ApiError(res.status, message);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(res.status, 'The register answered in a shape unknown here.');
  return parsed.data;
}

export const api = {
  me: (): Promise<Session> => call('GET', '/api/me', SessionSchema),
  register: (creds: Credentials): Promise<Session> =>
    call('POST', '/api/register', SessionSchema, creds),
  login: (creds: Credentials): Promise<Session> => call('POST', '/api/login', SessionSchema, creds),
  logout: (): Promise<Session> => call('POST', '/api/logout', SessionSchema, {}),
  board: (id: string): Promise<Board> =>
    call('GET', `/api/highscores/${encodeURIComponent(id)}`, BoardSchema),
  hall: (): Promise<HallGet> => call('GET', '/api/hall', HallGetSchema),
  foundHall: (name: string): Promise<HallGet> => call('POST', '/api/hall', HallGetSchema, { name }),
  invite: (name: string): Promise<HallGet> =>
    call('POST', '/api/hall/invite', HallGetSchema, { name }),
  requestJoin: (hall: string): Promise<HallGet> =>
    call('POST', '/api/hall/request', HallGetSchema, { hall }),
  answerPetition: (id: number, accept: boolean): Promise<HallGet> =>
    call('POST', `/api/hall/petitions/${String(id)}`, HallGetSchema, { accept }),
  leaveHall: (): Promise<HallGet> => call('POST', '/api/hall/leave', HallGetSchema, {}),
  expel: (name: string): Promise<HallGet> =>
    call('POST', '/api/hall/expel', HallGetSchema, { name }),
  halls: (): Promise<HallSummary[]> => call('GET', '/api/halls', HallsSchema),
};
