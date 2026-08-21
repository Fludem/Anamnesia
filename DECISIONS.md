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
