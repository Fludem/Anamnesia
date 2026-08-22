import { describe, expect, it } from 'vitest';
import { createNewSave } from '../sim/save.ts';
import { ServerSaveStore, type FetchLike } from './server-store.ts';

const record = createNewSave({ seed: 1, nowMs: 1000, writerId: 'tab' });

const answer =
  (status: number, body: unknown): FetchLike =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

describe('ServerSaveStore', () => {
  it('loads the raw record the register holds', async () => {
    const calls: string[] = [];
    const store = new ServerSaveStore((input, init) => {
      calls.push(`${init.method ?? ''} ${input}`);
      return answer(200, { record })(input, init);
    });
    expect(await store.load()).toEqual(record);
    expect(calls).toEqual(['GET /api/save']);
    expect(await new ServerSaveStore(answer(200, { record: null })).load()).toBeNull();
  });

  it('writes with the counter it read and takes the counter back', async () => {
    let sent: unknown = null;
    const store = new ServerSaveStore((input, init) => {
      sent = JSON.parse(init.body as string);
      return answer(200, { ok: true, saveCounter: 4 })(input, init);
    });
    expect(await store.write('main', record, 3)).toEqual({ ok: true, saveCounter: 4 });
    expect(sent).toEqual({ record, expectedCounter: 3 });
  });

  it('a 409 is stale with what is stored', async () => {
    const stored = { ...record, saveCounter: 7 };
    const store = new ServerSaveStore(answer(409, { ok: false, reason: 'stale', stored }));
    expect(await store.write('main', record, 3)).toEqual({ ok: false, reason: 'stale', stored });
  });

  it('a dropped connection, a busy register or a 5xx is unreachable, never a throw', async () => {
    const down = new ServerSaveStore(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await down.write('main', record, 0)).toMatchObject({ ok: false, reason: 'unreachable' });
    const busy = new ServerSaveStore(answer(503, { error: 'The register fell over. Try again.' }));
    expect(await busy.write('main', record, 0)).toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'The register fell over. Try again.',
    });
    await expect(down.load()).rejects.toThrow(/Could not reach/);
  });

  it('a refused save and a dead session are fatal', async () => {
    const refused = new ServerSaveStore(answer(400, { error: 'record.version: Invalid input' }));
    await expect(refused.write('main', record, 0)).rejects.toThrow(/refused the save/);
    const out = new ServerSaveStore(answer(401, { error: 'Not logged in.' }));
    await expect(out.write('main', record, 0)).rejects.toThrow(/session has ended/);
    await expect(out.load()).rejects.toThrow(/session has ended/);
  });
});
