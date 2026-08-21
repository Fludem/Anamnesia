# Project brief — browser idle RPG with a generated icon pipeline

Paste this as your first message to Claude Code in an empty directory, or save it as
`BRIEF.md` in the repo and tell Claude Code to read it.

---

## What we're building

A browser-based idle/incremental RPG in the shape of Melvor Idle: skills that train on a
tick loop, a large item pool, drop tables, crafting, and combat that resolves without
player input. Single-player for now, but the architecture must not rule out a shared
economy later.

The thing I care most about at the start is the **item and icon pipeline**, because that's
the part that normally kills solo projects. I want hundreds of items without me drawing or
sourcing hundreds of images.

## Non-negotiable architecture

- **TypeScript throughout.** Strict mode on.
- **Simulation is completely separate from rendering.** The sim is a pure module with no
  DOM access, no `Date.now()` inside it, and no React imports. It takes a state object and
  a tick count and returns a new state.
- **Deterministic.** All randomness goes through a seeded PRNG stored in the save state.
  Given the same save and the same number of ticks, the result must be byte-identical. This
  is what makes the whole thing testable and what makes offline progress trustworthy.
- **Fixed tick rate** (start with 100ms sim ticks decoupled from render frames). Offline
  progress = on load, diff the timestamp, and run the sim forward N ticks with a cap.
- **Content is data, not code.** Skills, items, monsters, drop tables, recipes all live in
  typed JSON/TS data files validated by a schema at load. Adding an item must never require
  touching engine code.
- **Save format is versioned** with a migration function from day one.

## Phase 0 — repo and asset pipeline

Do this before writing any game logic.

1. Set up the project: Vite + TypeScript + Vitest. No game framework, no Unity, no Phaser.
2. Vendor the icon set. **Do not browse and download icons one at a time** — the whole
   library is on GitHub:

   ```
   git clone --depth 1 https://github.com/game-icons/icons.git vendor/game-icons
   ```

   That's ~4,000 monochrome SVGs (white foreground on black background by default),
   licensed CC BY 3.0 with some entries CC0. Inspect the directory layout yourself and
   report back what the structure and per-author attribution data actually look like.
3. Build a script that walks the vendored repo and emits `src/assets/icon-index.json`:
   icon slug, author, licence, category/tags, and the raw path geometry extracted from the
   SVG. We want the path data inline in our bundle, not 4,000 separate file requests.
4. Generate `ATTRIBUTION.md` automatically from that index — every author whose icon we
   actually ship, in the form "Icons made by {author}. Available on https://game-icons.net".
   Regenerate it as part of the build so it can never drift out of date.
5. Build a dev-only icon browser page: search by name/tag, see the icon rendered. I'll use
   this to pick icons when I'm authoring content.

## Phase 0.5 — single-writer discipline (do this before any game logic)

Two classic idle-game bugs — the game breaking when it's open in two tabs, and offline
progress double-applying or silently vanishing — are the same bug: more than one thing
believes it owns the save. Solve it structurally, not with patches later.

**Exactly one tab runs the sim.**

1. Elect a leader with the Web Locks API: every tab calls `navigator.locks.request` on a
   named lock and holds it for its lifetime. Whichever tab gets it is the leader and is the
   only tab that ticks the sim and the only tab that writes to storage. When the leader
   closes or crashes, the lock releases and a follower is promoted automatically — no
   heartbeat/timeout logic needed.
2. Followers are read-only mirrors. The leader broadcasts state snapshots over a
   `BroadcastChannel`; followers render what they receive and send user actions back to the
   leader over the same channel rather than mutating anything themselves.
3. Show it in the UI. A follower tab should say plainly that the game is running in another
   tab, with a button to take over. Silent divergence is worse than a visible message.
4. `SharedWorker` is the other way to do this and is arguably cleaner, but its support
   history is patchier — check the current state and tell me which you'd pick and why
   before implementing.

**Storage writes are guarded even so.**

5. Every save carries a monotonically increasing `saveCounter` and the writing tab's UUID.
   Before writing, re-read the stored counter; if it's higher than the one we loaded,
   abort and reload instead of overwriting. This catches the case where the lock mechanism
   fails or an old tab wakes up from bfcache.
6. Use IndexedDB rather than localStorage. localStorage writes are synchronous, size-limited,
   and have no atomicity story worth relying on.
7. Save on `visibilitychange` → hidden and on `pagehide`. Do not rely on `beforeunload`, it
   is unreliable on mobile.

**Offline progress must be derived, never accumulated.**

8. Never count `setInterval` fires to advance the sim. Background tabs get throttled hard,
   so the tick count will drift from real time. The sim's tick counter is the single source
   of truth; work out how many ticks *should* have elapsed from timestamps and run exactly
   that many.
9. Store `lastProcessedTick` alongside a wall-clock timestamp. On load, compute the delta,
   then:
   - **Clamp negative deltas to zero.** Wall clocks go backwards — NTP corrections, the user
     changing their system clock, device sleep. A negative delta must never rewind state or
     produce a huge unsigned number.
   - **Cap the catch-up** (start with 12 hours) and tell the player what was capped.
   - Apply offline progress **only after acquiring the leader lock**, never before. This is
     precisely how two tabs each apply the same offline chunk.
   - Make it idempotent: the catch-up is keyed to a tick *range*, and a range already
     processed is a no-op.
10. Run catch-up in batches with yields to the event loop, with a progress indicator. Ten
    hours of 100ms ticks is 360,000 iterations — doing that synchronously freezes the tab
    and looks like a crash.
11. If you add a closed-form fast path for long idle stretches, it must be proven against
    the tick-by-tick path: a test that runs both from the same seed and asserts identical
    results. Otherwise offline and online play silently diverge and you'll never find it.

**Tests I want for this specifically:**

- Injectable clock (no direct `Date.now()` anywhere in the sim or catch-up logic).
- Simulated two-tab scenario: leader writes, follower attempts a write, follower's write is
  rejected and it reloads.
- Clock jumps backwards by an hour → state is unchanged, no crash.
- Catch-up at the cap boundary, and catch-up run twice over the same range → second run is
  a no-op.

## Phase 1 — simulation core

1. Save state shape: player, skills (xp per skill), inventory, equipment, bank, PRNG seed,
   tick counter, save version.
2. Tick loop and the offline catch-up path. Both must run through the *same* code.
3. XP curve and level lookup (RuneScape-style exponential is fine as a starting point —
   make the curve a single swappable function).
4. One gathering skill end to end (mining): select a rock, tick until the action completes,
   roll the drop table, add to inventory, award XP. Get this fully tested before adding a
   second skill — everything else is a variation on it.
5. Action queue abstraction so combat, gathering, and crafting are all the same primitive:
   an action with a duration in ticks, a success roll, and an outcome.

Write real unit tests for the sim as you go. Not smoke tests — tests that assert exact XP
totals and exact drop results from a fixed seed.

## Phase 2 — item and icon system

This is the interesting part. An item's visual is **derived**, not authored.

1. Define the item schema: id, name, base icon slug, material tier, item class, slot,
   stats, value, tags.
2. Define material tiers as palettes (bronze / iron / steel / mithril / adamant / rune /
   whatever we land on) — each is a small set of colours: primary, shadow, highlight.
3. Build a renderer that composes an item's icon at runtime from:
   - the base icon path geometry from the index
   - the material palette applied as fill/gradient
   - a rarity treatment (border, background gradient, glow)
   - optional small badge overlays in a corner (enchantment, set membership, poison)

   Output an inline `<svg>`. One sword icon plus six palettes plus four rarity treatments
   should give us a large visual space for a single asset.
4. Then build the **procedural composition layer** on top: decompose weapons into
   components (blade, guard, grip, pommel, gem) and generate icons by seeded combination,
   so a rolled item's appearance tracks its rolled stats. Start with swords only and prove
   it looks decent before generalising.
5. Cache rendered icons by a key derived from their inputs.

Show me a contact sheet page rendering ~50 generated items so I can judge whether the
output is good enough before we commit to it.

## Phase 3 — content

Only once phases 1 and 2 are solid. Generate the data tables in bulk — items, monsters,
drop tables, recipes — mapping each to sensible icon slugs from the index. Ask me for
direction on setting and tone before you write item names and descriptions.

## Phase 4 — UI

Panels, numbers, progress bars, icon grids. Melvor is visually just HTML and that's fine —
make it look intentional through typography, spacing, and a tight palette rather than
through art. Dark theme. Keep the render layer thin: it reads sim state and draws it.

## How I want you to work

- Work one phase at a time. Stop and check in with me at the end of each one rather than
  running ahead.
- Ask me questions when a design decision has real consequences — don't silently pick.
- Commit at meaningful checkpoints with clear messages.
- If you need an asset that isn't in the game-icons set, tell me exactly what's missing and
  what you'd want it to look like, and I'll source it.
- Keep a `DECISIONS.md` logging the non-obvious choices and why.

## Out of scope for now

Real-time multiplayer, 3D, animated sprites, sound, monetisation, mobile-native. Don't
build abstractions for these yet — just don't make them impossible.
