/**
 * The looks this tab has seen, by name and by hall, fetched in batches as screens ask for
 * them. A face asks with `useLook`; a name nobody has asked about yet, or whose look is older
 * than LOOK_TTL_MS, goes into the next batch (one request per frame, whatever asked). A look
 * the tab just painted is put here straight away, so the hill's own screens show it before
 * the register is asked again. Nothing here touches the save.
 */
import { useSyncExternalStore } from 'react';
import { api } from '../api/client.ts';
import { nameKey } from '../api/protocol.ts';
import type { Look } from '../look/look.ts';

export type LookKind = 'name' | 'hall';

/** A look seen longer ago than this is asked for again when a face next shows it. */
export const LOOK_TTL_MS = 5 * 60_000;
/** Names a batch asks at once (the route takes at most 100). */
const BATCH = 100;
/** How long to wait after a refused batch before asking again. */
const RETRY_MS = 30_000;

interface Entry {
  look: Look | null;
  /** When it was read; 0 while the first read is in flight. */
  atMs: number;
}

const keyOf = (kind: LookKind, name: string): string => `${kind}:${nameKey(name)}`;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Waiting to be asked: the key, with the name as given (the register answers by it). */
const pending = new Map<string, { kind: LookKind; name: string }>();
let flushing = false;
let refusedUntil = 0;
let clock: () => number = () => Date.now();
let fetcher = api.looks;

function notify(): void {
  for (const l of listeners) l();
}

function flush(): void {
  flushing = false;
  if (pending.size === 0) return;
  const batch = [...pending.entries()].slice(0, BATCH);
  for (const [k] of batch) pending.delete(k);
  const names = batch.filter(([, p]) => p.kind === 'name').map(([, p]) => p.name);
  const halls = batch.filter(([, p]) => p.kind === 'hall').map(([, p]) => p.name);
  fetcher(names, halls).then(
    (got) => {
      const at = clock();
      for (const [name, look] of Object.entries(got.names))
        entries.set(keyOf('name', name), { look, atMs: at });
      for (const [name, look] of Object.entries(got.halls))
        entries.set(keyOf('hall', name), { look, atMs: at });
      // Whatever the register left out stays unknown, to be asked again later.
      for (const [k] of batch) if (entries.get(k)?.atMs === 0) entries.delete(k);
      notify();
      if (pending.size > 0) schedule();
    },
    () => {
      // Refused: keep showing what was known, forget what was not, and ask again later.
      const at = clock();
      refusedUntil = at + RETRY_MS;
      for (const [k] of batch) {
        const e = entries.get(k);
        if (e?.atMs !== 0) continue;
        if (e.look === null) entries.delete(k);
        else entries.set(k, { look: e.look, atMs: at - LOOK_TTL_MS + RETRY_MS });
      }
      notify();
    },
  );
}

function schedule(): void {
  if (flushing) return;
  flushing = true;
  setTimeout(flush, 0);
}

/** Ask for a look unless it is fresh or already being asked for. */
export function askLook(kind: LookKind, name: string): void {
  const k = keyOf(kind, name);
  const have = entries.get(k);
  const now = clock();
  if (have && (have.atMs === 0 || now - have.atMs < LOOK_TTL_MS)) return;
  if (now < refusedUntil) return;
  entries.set(k, { look: have?.look ?? null, atMs: 0 });
  pending.set(k, { kind, name });
  schedule();
}

/** What the tab knows of a look: the look, null for none, undefined for not yet read. */
export function peekLook(kind: LookKind, name: string): Look | null | undefined {
  const e = entries.get(keyOf(kind, name));
  return e === undefined || (e.atMs === 0 && e.look === null) ? undefined : e.look;
}

/** A look this tab painted itself, shown everywhere at once. */
export function putLook(kind: LookKind, name: string, look: Look | null): void {
  entries.set(keyOf(kind, name), { look, atMs: clock() });
  notify();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The look of a name or a hall, asked for if the tab does not have it: null for none (show
 * the letter), undefined while it is still being read (show the letter too).
 */
export function useLook(kind: LookKind, name: string): Look | null | undefined {
  const look = useSyncExternalStore(subscribe, () => peekLook(kind, name));
  // Cheap when fresh or in flight; otherwise the next batch asks.
  askLook(kind, name);
  return look;
}

/** For tests: swap the clock and the route, and forget everything. */
export function resetLooks(opts: { clock?: () => number; fetcher?: typeof api.looks } = {}): void {
  entries.clear();
  pending.clear();
  flushing = false;
  refusedUntil = 0;
  clock = opts.clock ?? (() => Date.now());
  fetcher = opts.fetcher ?? api.looks;
}
