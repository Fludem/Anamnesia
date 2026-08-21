# Decisions

Non-obvious choices and why. Newest at the bottom. Dates are when the decision was made.

## 2026-08-21 — Phase 0

### Stack: Vite + React + TypeScript strict, npm, Vitest

React for the render layer because the brief's "no React imports in the sim" rule presumes it and the
render layer is meant to stay thin. npm because it is the only package manager on the dev machine.
The sim will be a pure TS module with no React dependency; React only ever reads state.

### Vendored icons are gitignored and pinned by commit; the generated index is committed

`vendor/game-icons` is ~4,200 files / 7 MB and changes upstream. Committing it would bloat history;
a submodule adds clone/CI friction. Instead `scripts/game-icons.lock.json` pins an exact upstream SHA,
`npm run icons:vendor` fetches that SHA, and the _output_ (`src/assets/icon-index.json`) is committed
so a fresh checkout builds and tests without the clone. Regenerating the index requires the clone;
bumping the pin is a deliberate lock-file change.

### Icon identity is `author/slug`, not `slug`

Upstream slugs collide across authors (`lorc/anvil` and `badges/anvil`, and others). Using the
directory as part of the id avoids ambiguity and makes attribution a property of the id.

### Upstream has no tags; search = slug tokens + curated overlay

The repo only ships SVGs and a `license.txt`; tags exist only on game-icons.net. Scraping ~4,200
pages was rejected as slow, fragile, and a one-off snapshot. Slug words ("broad-sword" → broad,
sword) are derived at search time, and `content/icon-tags.json` holds hand-curated synonyms that
grow as content is authored. The index builder fails if a tag references an unknown icon id.

### Production ships only referenced icons; attribution is derived from that subset

The full index is ~7 MB uncompressed — fine for the dev icon browser (lazy-loaded), wrong for the
game bundle. `scripts/build-shipped-icons.ts` collects icon ids from `content/icon-manifest.json`
and every `"icon": "…"` string in `src/content/**/*.json`, emits `src/assets/icons.shipped.json`,
and regenerates `ATTRIBUTION.md` from exactly that set on every `dev`/`build`. Adding content never
requires touching the pipeline.

### The SVG extractor is strict and fails the build on anything unexpected

Every icon sampled (65, including the five largest) is exactly a 512-viewBox `<svg>` with a
background rect path and one white foreground path. Rather than a general SVG parser, the extractor
asserts that shape and reports every deviation. Result at the pinned commit: 4,180/4,180 extracted.

### `badges/` is excluded

59 icons committed by the site maintainer with no entry in `license.txt`; they are game-icons.net's
own UI badges, not illustrative icons. Excluded rather than attributed to a guessed author.
`various-artists/` (2 icons) is kept and attributed as "Various artists".

### Phase 0.5 leader election: Web Locks + BroadcastChannel, not SharedWorker (provisional)

Checked August 2026: Chrome for Android only re-enabled SharedWorker in Chrome 148 (May 2026) after
years disabled, and its process lifecycle is still flagged as unpredictable. Web Locks has been in
every engine since Safari 15.4 (2022) and gives automatic release on tab death with no heartbeat.
Confirm at the Phase 0.5 check-in.

## Phase 0.5 — single-writer discipline

### Web Locks + BroadcastChannel (final)

Confirmed the provisional call above. `navigator.locks.request` queues followers in order and
releases automatically on tab death; no heartbeat or timeout code exists anywhere. Verified in
Chrome 151: a second tab is a read-only mirror, closing the leader promotes the queued tab
within a frame, and "Take over" moves leadership without a reload.

### Takeover is flush → ack → `steal`, with a `handing-over` state

A follower that wants to lead sends `takeover-request`. The leader stops ticking and saving but
_keeps the lock_ (so a third queued tab can never be promoted in the gap), flushes, and replies
`takeover-ack`; the requester then calls `locks.request(…, { steal: true })`, which rejects the old
leader's request promise with `AbortError` → it demotes and re-queues. If no ack arrives in 2 s
(frozen leader) the follower steals anyway; if nobody steals within 3 s the leader resumes.
Per spec `steal` cannot be combined with `signal` — Chrome rejects with `NotSupportedError` — so
the election never passes both (the fake lock manager enforces the same rule so tests catch it).

### New leader claim-writes before catch-up

On promotion the leader bumps `saveCounter` with its own `writerId` _before_ doing any work. A
straggling write from the previous leader (it flushed, then a periodic save raced the steal) is
then the one rejected, instead of the new leader going stale and reloading the tab the user is
looking at.

### Chromium quirk: abort before the LockManager connection is bound is lost

Observed in Chrome 151: if the page's very first `navigator.locks` call is a `request()` and its
`AbortSignal` is aborted in the same task (React StrictMode's mount → unmount → mount does exactly
this), the abort is ignored and the request stays pending forever — a dead host then sits in the
queue and a later legitimate follower never gets promoted. `warmLockManager` awaits one
`query()` before the first request and never issues a request whose signal is already aborted.

### Ticks are derived from the clock; the live loop and offline catch-up are one function

`setInterval(100 ms)` is only a wake-up. Every fire calls `planAdvance(tick, wallMs, now)` and
runs exactly that many ticks through `runAdvance`, which is also the offline path: a 100 ms
delta is a single batch with no yield, a 12 h delta is 216 batches with progress events and a
`MessageChannel` yield between them (`setTimeout(0)` is throttled to 1/min in hidden tabs).
Calls while an advance is in flight are dropped (re-entrancy guard); the anchor is committed per
batch, so the next plan is exact.

### Invariant: `wallMs` is the wall time of `sim.tick`

Every committed `{ sim, wallMs }` pair satisfies `wallMs = wallMsAt(plan, sim.tick)`. A save
taken mid-catch-up (visibilitychange during a long batch run) is therefore consistent, and the
next load resumes the remainder from the original anchor rather than re-extending the cap.

### Backward clock jumps re-anchor instead of waiting

A negative delta yields zero ticks _and_ moves the anchor to `now`. Keeping the old anchor would
freeze the game until the wall clock caught up — a day, after a mistaken clock change. This
admits a "set the clock back, then forward" exploit worth at most one cap per cycle; setting the
clock forward already farms progress just as well, so the marginal cost is nil.

### Stale write → reload, never overwrite

A `stale` result from the store's compare-and-swap (someone else wrote after we loaded) stops the
loop, releases the lock and calls `location.reload()`. Corrupt or future-version saves surface as
an error state; the game never starts fresh over a save it cannot read.

### `pagehide` flushes and releases; `pageshow` with `persisted` reloads

Chromium marks pages holding Web Locks bfcache-ineligible and evicts bfcached pages on
BroadcastChannel receipt, but Firefox/Safari behaviour is unverified, so the host makes it
deterministic itself.

### Guard-only mode on insecure contexts

`navigator.locks` is `[SecureContext]` and is undefined over plain `http://` on a LAN address. The
host then assumes leadership with a visible warning and relies on the save-counter guard alone.

### Purity is lint-enforced

`src/sim/**` and `src/runtime/**` (except `env.ts` and test doubles) cannot reference `Date.now`,
`new Date()`, `Math.random`, `performance.now`, timers, `navigator`, `document`, `window`,
`indexedDB` or `BroadcastChannel`; `src/sim` additionally cannot import React or other layers.

### Deferred

No closed-form fast path yet — with a placeholder sim it would prove nothing; the batch-size-
independence test in `advance.test.ts` is the shape the Phase 1 proof reuses. Snapshots are the
full `SimState` at 4 Hz; diff them once Phase 1 state grows.
