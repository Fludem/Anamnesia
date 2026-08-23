import type { HallSync } from '../sim/hall.ts';
import type { WheelSync } from '../sim/wheel.ts';
import type { SaveRecord } from '../sim/save.ts';

export type WriteResult =
  /** `hall` and `wheel` are what the register answered about each, when the store is the register. */
  | { ok: true; saveCounter: number; hall?: HallSync; wheel?: WheelSync }
  /** Someone else wrote first; `stored` is what is there now (null if the slot has gone). */
  | { ok: false; reason: 'stale'; stored: SaveRecord | null }
  /** The store could not be reached; nothing is known about the slot. Try again later. */
  | { ok: false; reason: 'unreachable'; message: string };

/**
 * Persistent save storage with a compare-and-swap guard.
 *
 * `write` succeeds only if the stored record's `saveCounter` equals `expectedCounter` (or the
 * slot is empty and `expectedCounter` is 0); it then stores the record with
 * `saveCounter = expectedCounter + 1`. Anything else is `stale` and returns what is stored so
 * the caller can abort and reload instead of overwriting.
 */
export interface SaveStore {
  load(slot: string): Promise<SaveRecord | null>;
  write(slot: string, record: SaveRecord, expectedCounter: number): Promise<WriteResult>;
  /** Dev/test helper: remove a slot. */
  clear(slot: string): Promise<void>;
}

/** Used by tests and by the two-tab harness; also the semantic reference for the IDB store. */
export class MemorySaveStore implements SaveStore {
  private readonly slots = new Map<string, SaveRecord>();
  /** Recorded for tests that assert the order/number of operations. */
  readonly log: Array<{ op: 'load' | 'write' | 'clear'; slot: string; writerId?: string }> = [];

  load(slot: string): Promise<SaveRecord | null> {
    this.log.push({ op: 'load', slot });
    const rec = this.slots.get(slot);
    return Promise.resolve(rec ? structuredClone(rec) : null);
  }

  write(slot: string, record: SaveRecord, expectedCounter: number): Promise<WriteResult> {
    this.log.push({ op: 'write', slot, writerId: record.writerId });
    const stored = this.slots.get(slot);
    const current = stored?.saveCounter ?? 0;
    if (current !== expectedCounter) {
      return Promise.resolve({
        ok: false,
        reason: 'stale',
        stored: stored ? structuredClone(stored) : null,
      });
    }
    const next = structuredClone({ ...record, saveCounter: expectedCounter + 1 });
    this.slots.set(slot, next);
    return Promise.resolve({ ok: true, saveCounter: next.saveCounter });
  }

  clear(slot: string): Promise<void> {
    this.log.push({ op: 'clear', slot });
    this.slots.delete(slot);
    return Promise.resolve();
  }

  /** Test inspection without going through the async API. */
  peek(slot: string): SaveRecord | undefined {
    return this.slots.get(slot);
  }
}

const DB_NAME = 'anamnesia';
const DB_VERSION = 1;
const STORE = 'saves';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB-backed store. The compare-and-swap is one readwrite transaction: the comparison
 * runs synchronously inside the `get` success callback and issues `put` or `abort()` before
 * returning, so the transaction never auto-commits between the read and the write. IndexedDB
 * serialises readwrite transactions on the same store across tabs, which makes this atomic.
 */
export class IndexedDbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onsuccess = () => {
        const db = req.result;
        // A future schema bump from another tab: drop our connection so it can proceed, and
        // reopen lazily on the next call.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
    }).catch((err: unknown) => {
      this.dbPromise = null;
      throw err;
    });
    return this.dbPromise;
  }

  async load(slot: string): Promise<SaveRecord | null> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE).get(slot) as IDBRequest<unknown>);
    return (result as SaveRecord | undefined) ?? null;
  }

  async write(slot: string, record: SaveRecord, expectedCounter: number): Promise<WriteResult> {
    const db = await this.open();
    return new Promise<WriteResult>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let outcome: WriteResult | null = null;
      const get = store.get(slot) as IDBRequest<unknown>;
      get.onsuccess = () => {
        const stored = get.result as SaveRecord | undefined;
        const current = stored?.saveCounter ?? 0;
        if (current !== expectedCounter) {
          outcome = { ok: false, reason: 'stale', stored: stored ?? null };
          tx.abort();
          return;
        }
        const next = { ...record, saveCounter: expectedCounter + 1 };
        store.put(next, slot);
        outcome = { ok: true, saveCounter: next.saveCounter };
      };
      // Resolve on commit, not on put success: put can succeed and the commit still fail
      // (quota), and only `complete` means the data is durable.
      tx.oncomplete = () => resolve(outcome ?? { ok: true, saveCounter: expectedCounter + 1 });
      tx.onabort = () => {
        if (outcome && !outcome.ok) resolve(outcome);
        else reject(tx.error ?? new Error('IndexedDB write aborted'));
      };
      tx.onerror = () => {
        /* handled by onabort */
      };
    });
  }

  async clear(slot: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(slot);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB clear aborted'));
    });
  }
}
