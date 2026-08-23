/**
 * The save store over the server (server/register.ts): the same compare-and-swap contract as
 * IndexedDB, one name's save per session cookie — the slot is whoever is logged in. A
 * connection that drops is reported as `unreachable`, not thrown: the host keeps playing and
 * tries again on its next save. Only the register refusing the save outright is fatal.
 */
import { HallSyncSchema } from '../sim/hall.ts';
import { WheelSyncSchema } from '../sim/wheel.ts';
import type { SaveRecord } from '../sim/save.ts';
import type { SaveStore, WriteResult } from './store.ts';

/** The part of `fetch` used here, injectable for tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* not JSON */
  }
  return `the register answered ${String(res.status)}`;
}

export class ServerSaveStore implements SaveStore {
  constructor(private readonly fetchFn: FetchLike) {}

  /** The logged-in name's save, raw: the host migrates and validates it like any other. */
  async load(): Promise<SaveRecord | null> {
    let res: Response;
    try {
      res = await this.fetchFn('/api/save', {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new Error(`Could not reach the hill's register (${String(e)}).`, { cause: e });
    }
    if (res.status === 401) throw new Error('The session has ended. Log in again.');
    if (!res.ok) throw new Error(await errorText(res));
    const body = (await res.json()) as { record: SaveRecord | null };
    return body.record;
  }

  async write(_slot: string, record: SaveRecord, expectedCounter: number): Promise<WriteResult> {
    let res: Response;
    try {
      res = await this.fetchFn('/api/save', {
        method: 'PUT',
        headers: JSON_HEADERS,
        credentials: 'same-origin',
        body: JSON.stringify({ record, expectedCounter }),
      });
    } catch (e) {
      return {
        ok: false,
        reason: 'unreachable',
        message: `could not reach the hill (${String(e)})`,
      };
    }
    if (res.status === 200) {
      const body = (await res.json()) as { saveCounter: number; hall?: unknown; wheel?: unknown };
      const hall = HallSyncSchema.safeParse(body.hall);
      const wheel = WheelSyncSchema.safeParse(body.wheel);
      return {
        ok: true,
        saveCounter: body.saveCounter,
        ...(hall.success ? { hall: hall.data } : {}),
        ...(wheel.success ? { wheel: wheel.data } : {}),
      };
    }
    if (res.status === 409) {
      const body = (await res.json()) as { stored: SaveRecord | null };
      return { ok: false, reason: 'stale', stored: body.stored };
    }
    if (res.status === 401) throw new Error('The session has ended. Log in again.');
    if (res.status === 429 || res.status >= 500) {
      return { ok: false, reason: 'unreachable', message: await errorText(res) };
    }
    // 400, 413, 415: the register will never take this save. Better to stop than to keep playing unsaved.
    throw new Error(`The register refused the save: ${await errorText(res)}`);
  }

  /** Nothing to clear: the register keeps the save. */
  clear(): Promise<void> {
    return Promise.resolve();
  }
}
