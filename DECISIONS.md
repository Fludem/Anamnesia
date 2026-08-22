# Decisions

Non-obvious choices and why. Newest at the bottom. Dates are when the decision was made.

## 2026-08-21 — Phase 0

### Stack: Vite + React + TypeScript strict, npm, Vitest

React for the render layer because the brief's "no React imports in the sim" rule presumes it and the
render layer is meant to stay thin. npm because it is the only package manager on the dev machine.
The sim will be a pure TS module with no React dependency; React only ever reads state.

### Vendored icons are committed as plain files, pinned by commit (reversed 2026-08-22)

Originally gitignored with a pinned fetch script, to keep history small. Reversed at the user's
request after Phase 1: `vendor/game-icons` (~4,200 SVGs, ~17 MB) is checked in as plain files with
no nested `.git`, so a fresh clone has everything needed to rebuild the index with no network
step, and content authoring (the icon browser) works offline. `scripts/game-icons.lock.json`
still records the upstream SHA; `npm run icons:vendor -- --refresh` replaces the tree with the
pinned commit, and that diff is reviewed and committed like any other. The generated
`src/assets/icon-index.json` stays committed too. Per-author `license.txt` files ship with the
tree, which is what CC BY 3.0 asks of us alongside `ATTRIBUTION.md`.

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

## Phase 1 — simulation core

### Phase 0.5 flagged items: left as they are

Reviewed before starting Phase 1. Backward-clock re-anchor stays (a few-second NTP correction
must not freeze the game; the exploit it admits is the one forward-clocking already grants).
Stale-write → reload stays (what the brief asks for; it never overwrites). Full-state snapshots
at 4 Hz stay: Phase 1 state is a few KB and structured-clone is far cheaper than diffing code
we would have to test. Revisit when the bank holds hundreds of distinct stacks.

### Everything is an action

`SimState.action = { current, queue }`. An action is a request (`{ kind, … , count }`), a
duration in ticks snapshotted at start, elapsed ticks, and a remaining count (`null` = until
stopped). Each kind has a handler with `canStart`, `durationTicks`, `successChance`, `resolve`.
The tick loop knows only the primitive; mining is the first handler and later gathering skills
are content, not code. Combat and crafting will be handlers with a different `resolve`.

### Draw order is a save-compatible contract

Per completed cycle: one float for the success roll (skipped entirely when the chance is
exactly 1), then per drop table per roll one float for the weighted pick and one integer draw
for quantity only when `max > min`. `mining.test.ts` re-derives 100 cycles from the rng
primitives independently and pins the literal results (seed 42: 84/100 successes, 161 ore,
7 gems, 8 rare gems, 2,100 xp). Changing the order silently changes every player's future.

### Commands are applied between ticks, never inside a catch-up

A command that arrives while an advance is running is queued and applied after the derived
range completes. The tick range stays a pure function of time, and replaying a catch-up can
never interleave differently. Leaders apply locally; followers forward over the channel and
render the result. A rejected command surfaces its reason (`commandError`) only on the tab that
issued it.

### Content: JSON under `src/content/`, validated once, referenced by id

`ContentDb.fromPack` validates shape with zod, then every cross-reference (drop → item, `$ref` →
named table, rocks → mining skill) and reports all problems at once. Named drop tables
(`drop-tables.json`) are shared via `{ "$ref": "gems" }` and resolved inline before the sim sees
them. The icon build already scans this directory, so an item's `icon` ships automatically.
Saves reference content only by id; removing an id is the only content change that needs a
migration.

### XP curve is a value, not a formula in the code

`SimContext.xp: XpCurve` — RuneScape's table by default (level 99 = 13,034,431 xp). The sim
never computes a level without going through it; swapping the progression is a one-line change
and the tests cover a linear table through the same interface.

### Success roll on gathering

Rocks define `success: { base, perLevel }`; chance = `min(1, base + perLevel × (level −
required))`. A failed cycle consumes its time and yields nothing. Tunable per rock; `{ base: 1 }`
gives Melvor-style never-fail nodes. The shipped numbers are placeholders for Phase 3.

### Inventory and bank are the same container type

Both are ordered `ItemStack[]`. `bank` is the main store gathering deposits into; `inventory`
exists in the save shape for carried consumables (food, ammo) that a later combat loop draws
from, and is unused until then. Equipment is a fixed record of eleven slots, all present, null
when empty — the shape never varies by save.

### v1 → v2 migration keeps tick and rng

The Phase 0.5 placeholder save migrates by keeping `tick` and `rng` (so the wall-clock anchor
stays valid) and initialising fresh game state. `migrate.test.ts` runs a real v1 record through
it. Verified in Chrome against the save left from the Phase 0.5 session (1.32 M ticks preserved).

### Still no closed-form fast path

432,000 ticks of the real sim run in well under a second, so there is nothing to speed up yet.
`advance.test.ts` proves batch-size independence (1 / 7 / 2,000 ticks per batch) against a
state that is actively mining a flaky rock, which is the exact shape a future fast path must pass.

## Phase 2 — item and icon system

### The design library is the source of every colour

The Claude Design screens (synced verbatim into `design/claude-design/`) define the palette;
nothing in Phase 2 invents a hue. Chrome tokens live in `src/ui/theme/` (CSS custom properties
and a TypeScript object, as the design brief asked). The thirteen material palettes are
**content** (`src/content/materials.json`) because an item's colour is data; rarity _definitions_
(id, rank, tag letter) are content too, while rarity _treatments_ (border, glow, text colour)
are theme, because the same colours chrome the toasts and modals. A test keeps `tokens.css` and
`theme.ts` in step and rejects pure black/white.

### Icon recipe: the design's CSS gradient, reproduced in SVG

The screens colour an icon with `mask` + `linear-gradient(150deg, highlight 8%, primary 50%,
shadow 96%)`. The renderer emits inline `<svg>` instead (the brief's choice — it composes layers,
survives copy/paste, and needs no mask-image support) with a `userSpaceOnUse` gradient over the
512 icon box at the same angle and stops, so a tile here is pixel-equivalent to the design.
Gradient ids are content-hashed from the three colours, so repeated ids across inline SVGs always
refer to identical definitions.

### Rarity never relies on colour alone

Three tiers ship (common / rare / epic — the design has no fourth; adding one is a content row
plus a theme entry). Rare and epic get a border, a glow (CSS box-shadow, only in the "juicy"
feel), a corner tag letter, and — on procedural swords — a gem in the guard. The glow stays in
CSS rather than an SVG filter so a 200-cell bank grid stays cheap.

### Badges are the design's own glyphs

`design/claude-design/badges/*.svg` were drawn in the design project (not game-icons), so they
ship without attribution as 256-space paths in `src/icons/badges.ts`. Badge kinds (enchanted,
upgraded, burning, locked, cursed) map to a glyph and a theme colour in `src/ui/items/badges.ts`.
The brief's "set membership" and "poison" kinds have no glyph yet — flagged, not invented.

### Swords are composed from parts, and the parts _are_ the stats

`rollSword(seed, { materialRank, rarityRank })` draws blade / guard / grip / pommel from a
seeded sfc32 stream (draw order pinned by test), sets a gem above common, and computes stats
from the same part table, scaled by material rank. Geometry for each part is authored in the
512 space with the blade up and rotated 45° at render. 5 × 4 × 3 × 2 × 2 = 360 silhouettes per
material × rarity. Grips use the `oak` palette; gems use `gem` (rare) or `aether` (epic), the
design's own pairing.

### Render cache is keyed on inputs, not path data

`specKey()` replaces every path with its layer id (icon id or `sword:blade:leaf`) and stringifies
the rest; the bounded `RenderCache` memoises markup by that key. The contact sheet shows hit
counts.

### Fonts are self-hosted

The screens load IBM Plex from Google Fonts. The game imports `@fontsource/ibm-plex-{sans,mono}`
instead: no third-party request from a tab that sits open for hours, and no flash of fallback
on a flaky connection.

### Content material mapping is provisional

Existing items got the nearest design palette (copper → copper, coal → basalt, uncut emerald →
willow as the design did, diamond → marble + epic…); tin has no design palette and renders
neutral. The weapon tier ladder on the contact sheet (copper → iron → basalt → silver → gold →
aether) is the design's mining ladder reused. All of it is Phase 3's to rename and rebalance.

### Fixed along the way

`crypto.randomUUID` is secure-context only, so the app threw before guard-only mode could engage
on a plain-http LAN address. `browserEnv` now falls back to `getRandomValues`.

## Phase 3 — content

### Setting and tone: the hill

Asked first, as the brief required. The user chose the world the design screens already imply:
a Sisyphus-adjacent hill — plain geological and material words (Copper Vein, Basalt Seam,
Hollow Elder), faintly Greek underneath (obols, shades, a discobolus, a laurel crown), no
elves, orcs or dragons. Names are Title Case, as the screens write them. Every item, zone and
monster gets one dry line: an observation, not lore. The content audit test enforces the
mechanics of the style (Title Case, one sentence, ≤ 140 characters, ends with a full stop);
taste is the user's to veto. Two lines the audit can't check but the house style rules: no
exclamation marks, and the hill never speaks.

### Scope: the focused roster

Mining (7 veins, the design's six plus a gold seam), woodcutting (the design's six trees),
smithing (65 recipes: bars, tools, weapons, armour, jewellery), five combat zones with 21
monsters, and 110 items. Fishing and firemaking appear in the design's navigation but ship no
content, so `skills.json` does not list them. Combat is **data only**: monsters, zones, drops
and coin ranges validate and render, but there is no combat loop yet — that is the next sim
phase, not a content one.

### The equipment ladder is the design's mining ladder

copper → iron → basalt → silver → gold → aether, carried on `material.tier` so the procedural
sword stats scale from data. Marble is worked stone, not a tier: quarried as blocks, cut into
whetstones that silver-and-above pieces need, and the binder for aether ingots. Basalt is
"knapped, not smelted" (a Basalt Core), which keeps a stone tier honest without inventing a
metal. Spears take a log for the shaft, the one cross-skill input between woodcutting and
smithing. A recipe may never output less value than it consumes (tested).

### Gathering is one handler; crafting is one more

`gatheringHandler()` takes a skill, a tool slot and a node lookup; mining and woodcutting are
two calls. `craftingHandler` consumes inputs when the cycle _completes_ (stopping early costs
nothing), and `tickAction` now re-checks `canStart` before restarting a cycle, so an action ends
by itself when inputs run out and falls through to the queue. Rocks and trees share
`GatherNodeDefSchema`; a third gathering skill is a content list plus one call.

### Tools are equipment in per-skill slots

`pickaxe` and `axe` join `EQUIPMENT_SLOTS` (save v2 → v3 fills them with null). A tool's
`gather` stat is a percentage cut to its skill's action time — the design's "Iron Axe −10%
action time" — applied at cycle start and rounded, never below one tick. Tools only fit tool
slots and nothing else does (content check).

### Containers open by command; procedural items roll from their id

`opens` on an item is a drop table rolled once per opened unit (the design's Bird's Nest).
`procedural: 'sword'` marks an item whose look comes from `rollSword(seedFromString(id))`, so
every "Copper Sword" is the same sword until rolled instances carry their own parts; the
authored `stats` are what the sim will use, the roll only draws the picture. Both are hooks for
later phases, not mechanics.

### Four rarities, two more badges

Legendary (rank 3, tag L) is the fourth tier the brief asked for. The design drew three, so its
treatment is built from the design's gold tokens (#d2a04c text, its shadow stop as border)
rather than a new hue. Three legendaries ship, all from the summit. The `set` (four tiles) and
`poison` (droplet) badge glyphs were drawn here in the design's badge style because the design
has none — replace them when it does.

### Equip, unequip, open

Three new commands so the content is reachable without Phase 4: equip swaps the worn item back
to the bank, unequip returns it, open rolls a container. Followers send them over the channel
like any other command.

## Phase 4 — UI

### The screens are the design's, built from its own classes

`src/ui/app.css` is Screens A (skill training), C (bank) and D (onboarding) rewritten as classes
over the tokens in `src/ui/theme/tokens.css`; no inline colour anywhere. Woodcutting is Screen A
with its Screen B data; smithing is Screen A with recipes where the veins were (category tabs,
inputs in the sub line, shortfalls in gold) — the design did not draw a crafting screen and this
keeps its skeleton rather than inventing a new one. Below 700px the sidebar becomes the design's
top bar + bottom tab bar. Components are React with CSS classes, not the contact sheet's inline
style objects, so the state rules (`.row.locked`, `.cell.selected`, `.juicy .bar-fill`) read in
one place.

### Screen D's login is not built; its onboarding is

The synced Screen D has email/password login and registration. The game is single-player and
local (the brief: "single-player for now") and has no backend, so there is nothing to log in to.
Building a fake login would be dishonest chrome. The "Name your hero" step _is_ built: it shows
on first run (a save still named `Nameless`), writes the name with the new `player:rename`
command, and the same calm card carries every full-page state — running in another tab,
catching up, stale, save error. When accounts arrive the login step slots in front of it.

### The sim gained what the screens needed, nothing more

Screen C sells items and buys bank slots; Screen A shows a drop feed, level-ups and an offline
recap. None of that existed in the state. Added in save v4 (migration 3→4 fills defaults):

- `coins` and the `sell` command (listed value × qty). Currency lives beside the bank, never in
  a slot.
- `bankSlotsBought` and `bank:buy-slot`: capacity is 30 + bought, priced on the design's curve
  (500 gp × 1.18ⁿ, rounded to 10). The numbers are Screen C's props; they are tuning, not law.
- `log`: a 40-entry ring buffer of events (`gain`, `level`, `opened`, `stopped`), tick-stamped,
  written by the handlers. The feed, the xp pops, the rare-drop toast, the level-up card and the
  "nest opened" modal all read it. It is in the save so followers show the same feed and so
  nothing in the UI has to diff snapshots.
- `stats.actions[skill]`: lifetime cycle counts, for "412 actions" and the recap.

### Bank full stops the action before the drop, never after

Melvor discards a drop that does not fit. Here `canStart` refuses a cycle when the bank is full
and _any_ possible drop of that node (or output of that recipe, or entry of that container) has
no stack to join; the action stops with a logged reason ("bank is full (no slot for Rough
Gem)") and the UI shows it in the idle card. Conservative — a vein whose gem you have never found
stops you at 30/30 even though the gem probably will not roll — but nothing is ever rolled and
thrown away, and the rule is one function (`roomFor`). A cycle that rolls two new items into a
bank with one free slot overfills by one; the next cycle then stops. Accepted.

### Offline recap is a diff, thresholded at five minutes

The host keeps the sim as it was before any advance of ≥ 3,000 ticks and exposes it as
`offline.before`; the UI diffs it against the current sim (`recap()` in `derive.ts`) for xp,
levels, actions and bank gains. Shorter absences get no modal — a reload after a coffee is not
"welcome back". The capped case reads "Offline progress is capped at 12h 00m. The other 1h 00m
did not count." Replaces the Phase 0.5 `cappedNotice`.

### Moments are derived from tick age, not timers

The level-up card shows while the newest `level` event is younger than 40 ticks; the rare toast
while an epic-or-better drop is younger than 26; pops while a gain is younger than 11. The
renderer never starts a timer for them and a follower sees the same moment at the same tick.
The cost is that a moment's visible length is game time, which in a throttled tab can pass in
one jump — acceptable for decoration.

### Followers get a calm page, not a mirror

Phase 0.5 rendered the game read-only in follower tabs with a banner. The design brief asked for
"a clear, calm screen explaining that, with a button to take over", so that is what follower
tabs show, with a one-line live status (skill, level, tick) so it is visibly alive. The runtime
still forwards commands from followers; the UI just does not offer any.

### Preferences are not save state

Which screen is open and the "feel" (deadpan / quiet / juicy, from the design's prop) live in
`localStorage`, per browser, validated on read and defaulted on failure. They never enter the
save: two devices may prefer different feels for the same hero.

### Fixed along the way

- `formatDuration` kept for elapsed time; action lengths now use `formatSeconds` ("2.2s").
- `window.confirm` is not used anywhere (it would block the tab under automation); destructive
  dev buttons confirm in place.
- The Phase 1 panels, banners and debug panel are gone; the debug buttons live under Settings →
  Dev in dev builds only.

## Phase 5 — gods, three skills, first steps, the 36-hour climb

No new design screen arrived for this phase; the brief was the rest of Screen D (choose your
god, the ready card), "build it like a tutorial", and two tuning asks: skills should average
about 36 hours of idle time to 99, and skills should feed each other, with quicker methods that
yield less and slower ones with other tradeoffs. Combat was explicitly deferred.

### Screen D's gods are real, and their boons are data

The design names four gods with boons that mention fishing, firemaking and cooking — skills the
game did not have. Building the picker with fake perks would have been the login form all over
again, so the skills came with it. A god is a content entry (`gods.json`) whose `perks` are
three generic knobs: `xp` (fraction per skill), `extraDrops` (one more table per successful
cycle of a skill), `doubleYield` (chance a cycle lands twice). The handlers read those through
`perks.ts` and never know a god by name. Vessith's "rare seed drops" is an `extraDrops` table
at 2% per cut; Maren's "+5% double catch" is `doubleYield` on fishing. The oath is one command,
once: the hill does not take oaths back (a later altar could, for gp). Xp is stored to a tenth
(18 × 1.1 = 19.8) rather than rounded per gain, so the bonus is exact over a night.

An old save with a name and no god lands on step 2; the onboarding writes the name at step 1
and swears only on the last button, so Back works until then. Copy on the god rows is the
design's verbatim; the ready card's lines are re-voiced for the hill as before.

### Three skills on the two primitives

Fishing is `gatheringHandler` over waters with the rod as its tool; firemaking and cooking are
`craftingHandler` over recipes. The recipe schema grew three things the skills needed and
nothing else: `requires` (levels in other skills — each dish wants a hotter fire, a Firemaking
level), `success` (cooking burns below a level, 0.6 + 2%/level, like a node's success rule) and
`failOutputs` (a burnt cycle still eats the fish and lands Charred Fish — one item, one bank
slot, sells for 1). A recipe may have no outputs: a fire makes ash, and ash is deliberately
worth 1 so that firemaking is the skill that burns value for xp. The content audit's "a recipe
never destroys value" rule has that one exception written into it.

The skill web: Mining → Smithing (bars, gear, tools) → faster Mining / Woodcutting / Fishing.
Woodcutting → Firemaking (fuel) and Smithing (spear shafts, rod handles). Fishing → Cooking →
food for the combat loop. Cooking is gated on Firemaking level, so Ashkar's two skills are one
path. Rods are smithing recipes (bar + log, whetstone at silver and above), so Fishing's speed
is bought with Mining and Woodcutting.

### Quick methods: more xp, nothing to bank

Every gathering skill has four `quick` nodes (scree, shale, pumice, cinder; brushwood, bramble,
deadfall, scrub; sprat shoal, bleak shoal, smelt run, char run) at levels 15/45/70/90. Each is
tuned to about +25% xp/hr over the tier's proper node at its unlock, and yields nothing worth
keeping: rocks give only the gem table, brushwood gives kindling (the weakest fuel), shoals
give fish that cook into small meals. They are flagged in content (`quick: true`), tagged QUICK
in the list, and left out of the progression model's standard path — a player who takes them
reaches 99 about 10% sooner and has less to show for it. The tier's node grows into them: by
ten levels past the quick node's unlock the proper node has usually caught up, since success
chance rises per level, so the choice keeps mattering. Smithing's version of the tradeoff is
gear: a piece pays the same xp per bar as smelting in half the time, so smithing gear is the
quicker route at the cost of more ore per hour.

### The 36-hour climb is a model and a test

`src/sim/progression.ts` computes hours to the cap for a skill by training the best open method
at every level, expected values only, with the tier's tool (a stated assumption, not a sim
rule) and no god. `src/content/progression.test.ts` asserts each trainable skill lands in
27–45 hours and the mean in 33–39; at the time of writing: mining 39.4, woodcutting 35.5,
fishing 35.7, cooking 36.0, smithing 33.7, firemaking 30.7 — mean 35.2. Mining is slowest on
purpose (ore is the most useful yield); firemaking fastest (it destroys what it trains on).

The measure is a skill's **own** action time on its standard method. Crafting skills also cost
feeder hours: smithing 99 on bars eats about 22,000 ore, cooking 99 about 19,000 fish,
firemaking 99 about 17,500 logs. Each crafting xp is priced at roughly 1.5× the gatherer's xp
per unit, so the feeder is always less time than the skill itself; the tuner prints the feeder
count and it is recorded here rather than hidden. The curve stays RuneScape's, so xp per
action rises steeply with tier (copper 20, aether 760): the last ten levels are 60% of the
total, and that is where the hours go. Level 64 from twelve hours of copper is still true —
and still only 3% of the way.

### First steps are the sim's, not the screen's

The tutorial is ten linear steps in `tutorial.ts`, each a title, a hint in the hill's voice,
the screen it happens on, a reward, and a progress function over **lifetime** counters
(`stats.items`, `stats.sold`, slots bought, the pick in its slot) so a step, once met, stays
met even if the bank is sold down. The sim checks the current step once per tick while the
walk is unfinished and logs a `tutorial` event; the card above every screen shows one step at
a time, links to the right screen, flashes the completion, and can be put away or brought back
from settings. Rewards sum to 550 gp — a little more than the first bank slot, which is the
last step. Migrated saves get the card too: every counter starts at zero for them, which is
honest about what the sim can know, and the skip is one click.

### Fixed along the way

- A `stopped` event now carries its skill, so an idle card only shows its own skill's reason.
  The 4→5 migration drops v4 stops, which have none.
- Skill screens are keyed by skill: the crafting screens shared a React instance and the
  category tab leaked from cooking into smithing, emptying the list.
- UI-only icons (hourglass, footprint) must be in `content/icon-manifest.json`; a test now
  scans `src/ui` for icon ids and fails if one is not shipped.

## Phase 6 — combat: Screen E, the fight loop, the price of dying

Two new design screens arrived: Screen E — Combat and Screen E — Equipment. The instruction
with them: ignore the design's "wake at the campfire" button; dying costs one equipped item,
chosen at random from what is worn on the body (head, torso…), never from the toolbelt.

### A swing is a cycle; the monster has its own clock

Combat is a request on the existing action primitive: `durationTicks` is the hero's swing
(30 ticks, plus the weapon's `speed` — a spear is +6, slower and heavier), `successChance` is
the hit chance, `resolve` rolls the damage and, when the monster falls, the kill. The monster
could not be squeezed into that shape — it swings on its own speed — so the primitive grew
one optional hook, `tick`, called every tick before the cycle advances. Combat is the only
handler that uses it; the monster swings there, the hero eats there, and the hero dies there
(the hook may clear `action.current`, and `tickAction` respects that). The fight itself
(`combat.fight`: monster, its hp, its swing timer, the last eight numbers that popped) lives in
the save, so a follower tab and a reload see the same fight.

### One combat skill, plus hitpoints

No attack/strength/defence split: there is one `combat` level, and `hitpoints`, an unlisted
skill (no screen, no nav row; an `HP` chip on the combat screen) that combat feeds at a third
of its xp. Max hitpoints = hitpoints level + 9, so a new hero has 10. The hero's numbers are
`level + 4 + gear`: attack against the monster's defence gives the hit chance
`(a + 2) / (a + d + 4)` (never certain, never hopeless); strength gives the max hit
`1 + floor(str / 2)`; a hit is uniform in 1..max. Small integers, all rolled on the save's rng.

### Xp is paid per point of damage

A kill pays exactly the monster's `xp`, but it is paid as the hits land, in proportion to
damage — so stopping mid-fight loses nothing and a swing that overkills pays only for what was
left. The reason is not fairness, it is the degenerate strategy: with xp-on-kill the first
tuning pass made a one-swing goat the best xp in the game until level 69. With damage-share xp
plus a level weight baked into the content (`scripts/tune-combat.ts`: `xp = hp × (1 +
level/15)`, then scaled to the target), the best monster at every level is the hardest one in
the newest open zone, and the progression test pins that shape ("never more than one zone
behind"). The Stone is not the best xp even at 90 — its defence makes the Minotaur better per
hour; the Stone is for its drops.

### The 36-hour model grew a combat climb

`combatClimb` assumes a gear ladder (copper 1, iron 10, basalt 25, silver 45, gold 60, aether
75 — the full set: sword, shield, helm, cuirass, greaves, boots), a hitpoints level derived
from the xp share, and an exact expected-swings-to-kill (a small dynamic programme, so overkill
counts). It reports, per level, the best monster, seconds per kill, damage taken per hour and
the monster's max hit against the hero's hitpoints. The test keeps combat in the 27–45 h band
(36.0 h now; milestones 50 at 1.1 h, 70 at 3.9 h, 90 at 16.9 h), every kill between 3 and 90
seconds, and no chosen monster able to take half the hero's hitpoints in one hit — so an eat
threshold of 50% holds as long as the bank has food. Food is the tradeoff: at the top the hero
loses about 2,000 hitpoints an hour, which is ninety pale fish or a hundred and fifty pike.
Fishing and cooking feed combat the way mining feeds smithing.

### Food is a bank item, eaten from the bank

No inventory: the hero names one bank item as food (anything with `heal`), and auto-eat takes
one from the bank when hitpoints fall below the threshold (default 25%, the design's number;
the screen cycles 25 / 50 / 75). The check runs before the monster's swing, so a threshold
above the monster's max hit is safe, and the food's count on the screen is the bank's count.
Out of combat, one hitpoint returns every ten ticks; in a fight only food helps.

### Death takes one worn item, not a trip to the campfire

When hitpoints reach 0: one body slot that holds something is picked uniformly at random and
its item is destroyed (a `died` event names it); the fight, the action and the queue end;
hitpoints refill. Tools are never taken — the design's toolbelt says "always with you" and the
instruction said so. With nothing worn, nothing is lost, and the banner says so. There is no
respawn timer and no wake-up button: the item is the whole price. The hero keeps what they
were wearing otherwise, so a death in iron costs one iron piece, not the set. The offline
recap counts deaths (`stats.deaths`, since the short log forgets) and names what it still
remembers being taken.

### The equipment screen equips too

The design's equipment screen only unequips ("equip from the bank" was the bank's job). An
empty slot that shows "nothing equipped here" with the matching items a click away in another
screen felt like a dead end, so the selected card lists what the bank holds for that slot with
an Equip button. The bank keeps its Equip as well.

### Fixed along the way

- `--hurt` (#c96a5a) joins the tokens: Screen E uses it for damage, the death banner and the
  STOP hover. It is the design's, not a new hue.
- Spears had `speed: -1`, which under the new meaning (ticks added to the swing) would have
  made them faster as well as heavier. They are +6 now.
- Save v6: combat state and kill/death counters, with a 5→6 migration that starts every hero
  at full hitpoints with no food chosen.

## Phase 7 — the gods fight too: foraging, offerings, favour

The ask: a combat first-steps step, and god combat perks that have to be recharged and cost a
resource, with a skill attached to gathering that resource. No new design screen; everything
is built from Screen A's list and Screen E's food row.

### A boon is content, and it runs on favour

Each god gains `perks.combat`: a kind (`attack`, `strength`, `defence` with a fraction, or
`regen` with a tick interval), a name and one dry line. Tharok's Stone Skin is +50% defence,
Vessith's Green Return a hitpoint every 6 s, Maren's Still Hand +60% attack, Ashkar's Ember
+15% strength. The boon is folded into `heroStats` whenever `combat.favour > 0`, so the fight,
the progression model and the screens all see the same numbers; the equipment screen's totals
read `gear` and stay honest about what is worn.

Favour is one integer on the save. It burns one every second (`FAVOUR_EVERY_TICKS`) while a
combat action runs and never otherwise — the gods only watch when it matters. When it hits
zero mid-fight, one of the chosen offering is burnt from the bank for its `favour` stat, so the
boon never lapses while the bank has offerings; the same shape as food (`combat.offering`
beside `combat.food`, `combat:offer` beside `combat:eat`). There is no cap and no manual
"cast": a player who wants the boon forages for it, chooses the offering once, and forgets it.
The regen boon heals inside the same tick hook the monster swings from, before the swing.

### Foraging is gathering by hand

The resource wanted a skill, so the fourth gathering skill is Foraging: `patches` in the
content pack (eleven: seven standard tiers from Wild Thyme to the Frankincense Terrace, four
quick), `foragingHandler` is one more `gatheringHandler` call with `toolSlot: null`, which the
handler and `toolAdjustedTicks` now accept. No sickle: a tool would mean a slot, a migration,
six recipes and six icons for a skill whose point is the offerings, and the model's climb lands
in the band without one (35.4 h). Offerings are `consumable` items with `favour` instead of
`heal`; the audit lets a consumable do one or the other, never both. A rare finds table (a
Bronze Sickle someone left, a Clay Votive someone else left) gives the drop feed something.

### What favour costs

An hour at any standard patch buys two to three hours of favour (a test pins the band). A
full foraging climb would feed about 80 hours of fighting — more than the 36-hour combat
climb, but not so much more that offerings are free: a hero who wants the boon for the whole
climb burns about half of everything they forage. Early on it bites harder, which is when the
boon matters least, so the tax feels fair rather than clever.

### The four boons are worth about the same

Measured in the progression model with favour never running out: the xp boons take 8% (attack)
and 12% (strength) off the combat climb; the food boons take 29% (defence) and 34% (regen) off
the hitpoints eaten. A test keeps each inside its band (5–20% hours, 20–45% food) and
`scripts/tune-boons.ts` prints the table. Attack needs +60% to be worth as much as strength at
+15% because the hit chance saturates; regen had to drop to one hitpoint per six seconds
because a flat rate is enormous against a low-level monster and still a third against the
Stone.

### First steps: fight, forage, offer

Three steps after cooking: kill three Hill Goats (the cooked minnows are the food), gather
five Thyme Sprigs, burn an offering. They read lifetime counters like the others
(`stats.kills`, `stats.items`, `stats.offered`). Rewards now total 750 gp; the first bank slot
still costs 500.

### Fixed along the way

- The bank's Food filter matched `class === 'consumable'`, which would have listed offerings
  as food; it matches `heal` now, and Offerings has a filter of its own.
- Save v7 with a 6→7 migration (no offering, no favour, nothing burnt); the fight in progress
  survives it.
- The onboarding god cards show the combat boon under the existing boon line, since the
  choice now has a second consequence.
