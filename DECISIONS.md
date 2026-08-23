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

## Phase 8 — the empty slots: gauntlets, capes, javelins, rings

The ask: gear for the slots nothing filled — hands, cape and ammo — and the two that only
filled past level 58 (ring, neck). Still no new design screen. The design's equipment mock
had seven worn slots (no hands, ring or ammo) and pictured the cape as xp gear: "Woodsman's
Cape, +3% woodcutting" next to an "XP BOOST" total. That mock decides what a cape is here.

### Gauntlets are the seventh set piece

Hands fill from the anvil like everything else: `<tier>-gauntlets`, one bar (and a whetstone
from silver up), a level after the tier's boots, defence like boots plus a point or two of
attack — a steady hand. The progression model's set grew to seven pieces, which moved the
combat climb from 36.0 to 35.8 hours; nothing retuned.

### A cape boosts xp, and the hill leaves it for you

`ItemDef.xpBoost: { skill | null, fraction }` is the design's "+3% woodcutting" as content;
`xpMultiplier` adds every worn boost to the god's (they add, they do not multiply), so a
sworn Tharok in a Miner's Cape mines at +15%. `skill: null` is the mock's amulet ("+2% all
skills"), used once, on the Rune Pendant.

Seven skill capes, one per skill with a screen and no fight, +5% in that skill. They are not
smithed and there is no tailor: each skill has a `finds` table, rolled once per successful
cycle on top of whatever the cycle paid (`src/sim/finds.ts`), at one in two thousand — an
hour or two of work at the standard nodes. The roll is skipped, not wasted, when the bank
has no room, so a full bank costs no rng and finds nothing. A fight never rolls (combat's
table is null and the action runner says so). A find is its own event (`found`), marked in
the drop feed and named in the recap; a second cape sells. Combat's capes come from the
beasts instead: Goat-Hide, Wolf Pelt, Hound, Bull-Hide, one per hide-wearing zone, at 1% of
the beast's drop, with defence and a little strength.

The equipment screen gained the mock's fourth figure, XP BOOST, beside attack / strength /
defence; it is the worn boosts added up, with the per-skill lines in the tooltip and on the
selected card.

### Javelins: ammo from the bank, thrown when a swing lands

`ammo` was in the slot list since Phase 4 with nothing to put in it. Now it holds a javelin,
smithed twenty to the bar (plus a log) at the tier's sword level, adding attack and strength
to the swing. Every swing that lands throws one: from the bank's stock first, and when that
is gone the one in the slot goes and the slot empties — so equip and unequip keep their
ordinary meaning (one item moves), death picks from the slots minus ammo (`LOSABLE_SLOTS`; a
javelin is not worth taking), and nothing in the save changed shape but a `thrown` counter
(save v8). A miss throws nothing. The fight card shows the count beside the name, red on the
last one; the equipment screen shows the stock.

Measured in the model with the tier's javelin always in hand: 8% off the climb and 8% off the
food, for 46–52 bars an hour at every tier (`scripts/tune-gear.ts`; a test pins 5–15% and
40–60 bars). That is a bar every minute or so: cheap in copper, dear in aether, which is the
point — nobody will throw aether, and gold javelins at the top are the sane choice.

### Rings and necks below silver and above gold

Copper Band (8) and Copper Torc (9) so the slots fill in the first hour; Basalt Ring (34) and
Basalt Pendant (35) give Rough Gem its first use; Rune Pendant (76) gives Rune Stone its first
use and carries the "+2% every skill" boost; Aether Ring (89) and Aether Pendant (90) take a
shard each. Every recipe still pays more than it eats.

### Fixed along the way

- `BODY_SLOTS` and the worn-items walk moved out of `combat.ts` into `src/sim/equipment.ts`
  so perks can read worn gear without importing combat.
- The content audit now checks that every body slot fills from the anvil at every tier, that
  every listed non-combat skill finds exactly its own cape at the same odds, and that only
  worn items carry an xp boost.

## Phase 9 — highscores: the hill's other names

The ask was highscores for each skill, wealth and total level. A highscore is a rank, and a
rank needs other names; the game is single-player with no backend (see "Screen D's login is
not built"). So the board ranks the hero against a roster of people who are also on the hill.

### The others are curves, not players

`src/content/rivals.json` holds sixteen names — faintly Greek, one dry line each, a sworn god
or none. None of them is simulated. Each skill entry is `hours` (how far along that skill's
standard climb in the progression model they were when the hero arrived) and `pace` (how many
climb-hours they add per hour of the hero's game time); wealth is a line the same way.
`src/sim/highscores.ts` turns the climb into a per-level xp/hour table (the best method open
at each level, with the tier's tool — combat from `combatClimb`) and integrates: "forty hours
of mining" is exactly where a full-time miner would be, and retuning the content moves the
roster with it. Hitpoints is never authored; it follows combat at `HITPOINTS_XP_SHARE`, as the
hero's does. Past 99 the top rate keeps paying, so there is always someone above to catch.

The board reads `sim.tick` and nothing else — game time, offline catch-up included — so it is
deterministic, needs no save change, and the same save shows the same board in every tab.

A rival's paces add up to at most one: they are one person each (the content audit checks).
The climb is front-loaded (level 50 near one hour, 70 near five), so the roster spreads: three
at the cap on purpose (Old Demos in mining, Xanthe in firemaking, The Quiet One in combat),
specialists in the 70s–90s, everybody dabbling somewhere in the 20s–50s, and Pyrrha, who
arrived a week before the hero and is passed in the first hour. The audit pins that every skill
has someone at 80+ on day one, at most two at the cap, and that a fresh hero is last on every
board.

### What a board is

Total level is every skill added up, hitpoints included, with total xp breaking ties. Wealth
is coins plus the bank at sale value plus everything worn, tools and ammo included — what the
hero would have if they sold up. A skill board is xp, level shown. Ties go to whoever was here
first: rivals before the hero, then roster order.

### The screen

`HighscoresScreen`: the hero's own standing on every board (rank, level, xp) on the left — it
doubles as the board picker — and the chosen board on the right, best first, the hero's row
lit, rank 1 in the design's gold, each name's line as the row's sub and their god's mark as a
small icon. Under 700px the standing list becomes a two-column strip of pickers and the lines
drop. The view pref remembers which board was open. No design screen exists for it; it is
built from Screen A's rows and Screen E's columns.

### When accounts arrive

The roster was the placeholder for real names. Phase 11 brought the names and removed the
roster; the ranking, the screen and the tie rule stayed.

### Fixed along the way

- A save from an earlier build can name content this one no longer has (a phase-1 save was
  still mining `coal-rock`); migrations only know the save's shape, so the sim crashed on
  the first tick and the skill screen with it. `src/sim/reconcile.ts` now runs once on load,
  after migration, with the content in hand: an action, a queued request, a stack, a worn
  item, the chosen food or offering, a fight or a log line naming something that is gone is
  dropped, everything else is kept, and the host logs what went. A clean save comes back by
  identity. Content ids remain the only thing a content change can break, and now it breaks
  softly.

## Phase 10 — the coin sink: the trader and the ferryman

The ask: a coin sink. Coins came in three ways — selling at full listed value with no
friction, ten monsters' small gp ranges, 750 gp of first steps — and went out one: the
bank-slot curve, which stops mattering once the bank is big enough. A read of the progression
model (`coinsPerHour` in `src/sim/progression.ts`, printed by `scripts/tune-trader.ts`) puts
income near 10k gp/h at level 1 mining (the gems), 45k at 45, 125k at 75 and over a million at
aether, so a fixed price is a purchase in the early-mid game and a rounding error at the top.
Two things already in the content pointed the way: the Obol ("One coin for the ferryman. He has
stopped counting.") dropped rarely and did nothing, and Phase 5 left the oath's permanence with
"a later altar could, for gp". The user chose the ferryman at twice the worth, paid by default,
and release from the oath from 100,000 gp doubling.

### The ferryman is the sink that keeps pace

Death cost one worn item (Phase 6, the user's rule). Now, when the hero falls, the slot is
rolled as before and the ferryman is offered for what it holds: an obol from the bank settles
it outright; else, if the hero pays him (`combat.ferryman`, on by default) and can, twice the
item's worth in coins; else the item goes as it always did. The fee tracks the gear — pennies in
copper, 3,200 gp for a silver cuirass, 91,000 for an aether one — which is the one price in the
game that cannot be outgrown, and it is paid at the moment the loss would have landed, so it is
never a purchase nobody makes. Twice, not once, so paying is a decision and not the obvious
move: remaking the thing from bars is cheaper in coin and dearer in hours. On by default because
an idle player who never found the toggle would otherwise lose a 45k cuirass to a setting; the
fight screen carries the row, the trader's card repeats the terms, and the death line says
which way it went ("the ferryman took 1,330 gp for your Silver Sword" / "an obol paid the
ferryman · your Silver Sword stays" / "the hill took your …"). The obol is free because it is
rare (0.5% a catch at four waters, two shades) and because "he has stopped counting" was
already written; nothing sells obols.

`FERRYMAN_MULTIPLIER` and the `coin` tag live in `src/sim/skills/combat.ts`; the `died` event
gained `kept`, `paid`, `obol` with defaults so a v8 log still parses; `stats.spent` counts
every coin that leaves (slots, wares, the ferryman) and `stats.ferried` the crossings, so the
recap can say what the night cost without a purchase event.

### The trader sells what the hill can take coins for

`src/content/trader.json` is a new `wares` collection: a name, one dry line, an icon, a price,
and an engine-known effect, the way a god's perks are content. `price × growth^bought`, rounded
to 10 gp; a `once` ware is sold one time; `requires` makes a ladder. `src/sim/trader.ts` prices
and sells them; `state.upgrades` is a count per ware id, so a purchase survives a content
change the way everything else does (reconcile drops a ware that is gone).

- **The lamp ladder** — A Lamp 5,000 gp (the night lasts 16 h), Oil for the Lamp 25,000 (20 h),
  A Long Wick 100,000 (24 h). Offline progress was capped at 12 h since Phase 0.5; the cap is
  now `max(base, the best lamp owned)` (`offlineCapTicks`), and the host learns it through a
  `capTicksFor` option rather than a new constant, so the runtime still knows nothing about
  wares. A test pins each rung at under an hour of the best gathering income at its level
  (0.3 h at 20, 0.55 h at 45, 0.8 h at 75) so it stays a purchase and not a milestone.
- **A Second Look** — 15,000 gp; a skill's `finds` table rolls twice a cycle. The one ware for
  someone who never fights.
- **Release from the Oath** — 100,000 gp, doubling each time. Buying it sets the god to none;
  the existing "choose your god" page appears and the hero swears again. Favour stays: it is
  the hill's, not the god's, and the next oath inherits it. The user set the opening price
  (my draft said 5,000); at 100k it is a late-game decision, which fits "the hill does not take
  oaths back" being mostly true.

No design screen exists for the trader; `TraderScreen` is Screen A's rows with a price and a
Buy on the right, a lock on the rungs that wait on another, and Screen E's columns with the
ferryman's terms on the side. The bank's `+` cell keeps selling slots; they were the design's
and stay where it put them.

### What is still wrong with the economy

The tune script makes it plain: item values climb far faster than the xp curve (an aether smith
adds ~2.9M gp an hour by the model; an aether cuirass sells for 45,641), so past level 80 no
fixed price means anything and only the ferryman scales. That is the content's value ladder,
set in Phase 3 before anything spent coins, and the real fix is a retune of `value` across the
top tiers — a later phase, because the bank curve and every sale price move with it.

## Phase 11 — the register: names, passwords, saves on the server, real highscores

The user's ask: "multiplayer with a DB and a login system and register system". For an idle
game that means three things — an account, a save that follows the account, and boards
that rank accounts — and not a fourth: nobody fights anybody; the hill is shared only through
the board.

### One process, node's own parts, no new dependencies

The server is `node:http` + `node:sqlite` + `crypto.scrypt`, in TypeScript under `server/`,
importing the sim it shares with the game. No framework, no ORM, no Postgres to run: the
register is one file in `data/`, the production server is one bundled file (`vite build
--ssr`) serving `dist/` and `/api` from one port, and in development the same handler mounts
inside Vite (`server/vite.ts`) so `npm run dev` is still the whole game. Sharing the sim is the
point: the server validates a save with the same `SaveRecordSchema`, scores it with the same
`standingsOf`, against the same content — there is no second definition of anything. Node 24+
is required for `node:sqlite`; the user has 26.

### The save store did not change shape

`SaveStore` (load + compare-and-swap write on `saveCounter`) was designed for tabs fighting
over IndexedDB; a server is the same fight with more contestants. `ServerSaveStore` speaks
the same interface over `GET`/`PUT /api/save`, the server's `writeSave` is the same guard in
SQL (`409` carries what is stored), and the host needed two additions rather than a rewrite:

- A write can now come back `unreachable` as well as `stale`. A laptop waking before its wifi
  does fires the periodic save into nothing; before, a store throw ended the game with an
  error page. Now the host keeps playing, shows "not saved … trying again" in settings, and the
  next save clears it. Only the register refusing a save outright (400/413) is fatal — better
  to stop than to play unsaved.
- `onStale: 'hold'`. With IndexedDB a stale write meant a tab back from the cache: reload and
  carry on. With a server it means another browser or device took the save, and reloading
  would claim it back — the two would take turns overwriting each other forever. The stale tab
  now stops, keeps the Web Lock (so no follower tab here promotes itself into the same fight)
  and shows "This tab stepped back … Play here instead". The player chooses which device
  plays. The other device gets the same page on its next save.

One allowance in the guard: a reply can be lost after a write lands, and the tab would then
be stale against its own save. The server accepts a write one counter behind when the stored
record's `writerId` is the same tab — the record it holds is newer than the one it wrote, so
this is safe, and it is exactly the lost-reply case and nothing else.

### The name is the hero's name

The design's login screen asked for an email; the register asks for a name — the hero's, 3–16
characters by the sim's own `PlayerNameSchema`, unique without regard to case — and a
password of eight or more. No email means no password reset by mail; `scripts/reset-password.ts`
is the operator's way back, and that is flagged below. Step 1 of the onboarding ("name your
hero") became the registration form; steps 2 and 3 (the god, the ready card) stayed. The host
writes the account's name over the save's on load and the server stamps it on every write, so
rename went from settings: a name is an account now. `player:rename` is still a command the
sim accepts; nothing sends it.

### What the server trusts

The client. The sim runs in the browser as before; the server stores what it is sent,
validates the shape, and scores it. A player who edits their save in the console is on the
board with whatever they wrote. Re-simulating every account server-side would make the
register authoritative and is the right next step if strangers ever play; for a hill of
friends, the honest note in the README is the cheaper guard.

Passwords are scrypt (N=16384) with a fresh salt, stored as one string that names its
parameters. Sessions are 32 random bytes in an `HttpOnly; SameSite=Lax` cookie, ninety days
sliding, hashed at rest; a copy of the register logs nobody in. State-changing routes require
`Content-Type: application/json`, which with `SameSite=Lax` is the CSRF guard without a token
dance. Wrong passwords are limited per name and per address; new names per address. The same
message answers an unknown name and a wrong password.

### The board ranks saves, not play

A standing is recomputed on every save write (every ten seconds while playing) into a
`standings` table keyed by board, so a board is one indexed query, ranked by `key1 DESC, key2
DESC, user id ASC` — ties to whoever made their name first, the same rule as before with
"made their name" for "was here first". The screen reads `GET /api/highscores/:board` (the
top hundred plus the caller's own row if further down, and the caller's standing on every
board) when the board changes, after each of this tab's saves, and every half minute. So a
row can be a save behind the game; "last seen" on each row is when that name last saved, and
within ninety seconds reads "on the hill now". Anyone may read a board; only a name that has
saved is on one.

### The browser's old save is offered, once

Before names, the save lived in IndexedDB. The first time a name plays in a browser and has
no save of its own, `runtime/adopt.ts` migrates and reconciles the local save, writes it as
the name's first, and clears it locally so a second name on the same browser does not inherit
it too. A name that already has a save leaves the local one alone. The user's phase-1 save
with its hundreds of hours on the clock is how the rivals got to 99; it will now be theirs.

### Flagged

- No email, so no password reset but the operator's script. No account deletion either.
- The server trusts the client's save (above).
- The follower page still says "another tab" when the save was taken by another device; a
  follower cannot tell. The stale page covers both.
- The hero's own row on the board lags the game by up to a save. The standing column is
  server-side too, so a level gained in the last ten seconds shows on the skill screen first.
- One process, one SQLite file: fine for a hill of friends; not a deployment story beyond
  "run it somewhere with a disk and put TLS in front" (the cookie is `Secure` whenever the
  request arrives over https, directly or by `x-forwarded-proto`).

## Phase 12 — the hall: clans that raise a place on the hill

The user asked for a social layer, PvP or base building, leaning clans. This is clans _as_
base building: a name founds a hall, names join it, and together they raise its rooms with
what the hill gives them. A raised room does a little for everyone in it.

### Why a hall and not the ring

Phase 11 left the server trusting the client's save, which is fine for a board and wrong for
anything where one name's loss depends on another's save — a console-edited save becomes a
weapon. A hall loses nobody anything while they are away, works for a hall of one, and is the
half of the economy fix the trader could not be: until now every item's only destination was
the sell button, and the top tiers inflate (Phase 10's flag). Rooms eat logs, ore, bars and
fish in the thousands. The ring stays possible on the same plumbing — a duel's result could
reach the sim exactly the way a raised room does — but it needs the server to re-simulate
first, and that is a bigger phase than this one.

### Gifts ride inside the save; the register answers the save

The hall is shared, so it lives in the register: members, each room's tier and progress, and a
ledger of every gift. The sim stays pure and client-owned, and holds only what the register
last said — which hall this name is in, how the rooms stand — plus a cart: `hall:give` takes
the items (or coins) out of the bank and appends a `Gift` to `sim.hall.gifts`. Nothing else
happens in the sim. The next save carries the cart; inside `writeSave`'s transaction the
register moves each gift into the hall, clipped to what the room still needs, and answers the
write with `{ id, rooms, took, given }`. The host applies that answer in memory (`applyHallSync`:
refund the difference, drop the answered gifts, set the rooms) and does not save again.

Two things were considered and rejected. A second endpoint (`POST /api/hall/give`) would mean
two writes that could disagree: the client's sim has already removed the items, the stored
save has not, and a crash between the two either duplicates or loses the gift. A gift in the
save is in the save or it is not. And stripping the answered gift from the stored record —
the obvious tidy-up — was a real hole: a tab that died between the reply and its next save
would reload a record with no gift and no refund. So the stored record keeps the gift; the
client's own next save removes it; a re-sent gift is answered from the ledger the same way.
That makes the answer droppable, which is what lets the host ignore it whenever the tab is no
longer leading or is mid-advance: the next save asks again, nothing is lost.

The details that fell out of the review: gift ids are integers numbered by the sim
(`hall.given`), and the register stamps `given = max(record's, ledger's)` back into the save
so a reset save (Settings → Reset writes `given: 0` straight to the store) cannot reuse a
number. A gift names the tier it was meant for; a tier another member finished first sends
it back whole rather than quietly funding the next. The cart is capped at 100 gifts and a
gift at a million — one save cannot hold the SQLite write lock for long. A refund into a full
bank is allowed to overflow by a stack, as `unequip` already does; the cap is enforced before
a roll, never after. And the sync is not a `Command`: it never enters the channel, so a
follower tab cannot forge rooms over it.

Perks read `sim.hall.rooms`, so the sim is still a function of (save, ticks, commands), and
offline catch-up uses the rooms as of the last save. A tier another member raises while you
are away applies from your next save, not retroactively. Acceptable for an idle game.

### What the rooms do, and why so little

Six rooms, three tiers each, one perk kind per room, the total at each tier in content:
the Hearth (+1/2/3% xp everywhere), the Storehouse (gathering lands twice 3/6/9%), the Larder
(food heals 10/20/30% more), the Strongroom (+5/10/15 bank slots), the Watchtower (the night
+2/4/6 h), the Pyre (the ferryman takes 10/20/30% less). Each plugs into a hook that already
existed — `xpMultiplier`, `doubleYieldChance`, `eat`, `bankCapacity`, `offlineCapTicks`,
`ferrymanFee` — so a new room is a content entry. The user chose small perks: a reason to be
in a hall without making a name alone feel punished. The Strongroom is the one players will
feel; fifteen slots is half a bank. The perk shapes that did not exist (double yield for
crafting, favour) were left out rather than invented.

Costs climb the material ladder so every member's skill is wanted, and are set against the
model: `hoursToMake(item, qty, level)` in `progression.ts` prices an item in hours of one
name's gathering (or smithing, inputs included), and the content test pins each tier — I in
0.5–3 h at level 20, II in 2–8 h at 55, III in 5–20 h at 80, of one name's work, which a hall
of three shares. `scripts/tune-hall.ts` prints the breakdown. Coins come in from tier II: a
second coin sink, but never the only thing a tier wants. (Retuned much heavier, and across
every skill, when the hill went live — see "Going live" below.)

### The door

Joining is by invite or by asking; the founder decides. Any member may invite; a request
waiting at the door is answered by the founder; an invite meeting a request, in either order,
is simply a join. A name asking sees where it asked and may withdraw. A founder leaving hands
the keys to whoever has been there longest; the last name out closes the hall, and the ledger
keeps its rows (they carry the hall's id, which goes null). A hall holds twenty names. There
is no second rank: the hill is a hall of friends.

### What is trusted

The client's gifts, exactly as its save is — the register never checks the items were in the
bank. Hall progress is therefore a shared resource on the same honour system as the boards,
and the README's note stands. The first time strangers play, re-simulating saves server-side
is the fix for all of it at once.

### Flagged

- No design mock for the hall; the screen is Screen A's rows and Screen E's columns again, and
  the give modal is the bank's sell-amount modal with a what-to-give row on top.
- The list of halls is a card on the no-hall screen, not a board: the boards rank names.
- Tuning numbers are the model's, not play's. Tier III of the Hearth is 17 h of one name's
  elder logs; that is on purpose, it is the flagship room. (Since retuned: see "Going live".)
- The narrow layout was checked for the hall's rows only; the trader's buy cell now wraps at
  700 px, which it did not before. The full narrow pass is still owed.

## Going live — the box, the night, and the price of a room

### One box, one process, Caddy in front, Cloudflare in front of that

`deploy/` is the whole of it: `setup.sh` turns a fresh Ubuntu box into the hill (node 24 from
NodeSource and Caddy from its own repository, since Ubuntu's are a major version behind each; a
system user; `/opt/anamnesia` for the build and `/var/lib/anamnesia` for the register; a
systemd unit with the filesystem read-only but the register's directory; a daily `sqlite3
.backup` kept a fortnight), and `scripts/deploy.sh` builds and rsyncs `dist/` and
`dist-server/` and restarts. The server bundle now carries zod inside it (`ssr.noExternal`), so
a deploy is two directories and a node binary — no `npm install` on the box, nothing to drift.
`HOST=127.0.0.1` keeps the app off the public interface; Caddy is the only thing on 80 and 443.

The name is proxied through Cloudflare, which decided two things. The origin answers on both 80
and 443 without redirecting, because Cloudflare's default ("Flexible") speaks plain HTTP to the
origin and a redirect there loops. And Cloudflare's published ranges are Caddy's
`trusted_proxies`, so `X-Forwarded-For` reaches the app as the player's address and the
register's per-address limits (ten new names an hour, forty wrong passwords a quarter hour)
count players, not the edge — without that every player on the hill would share one bucket.
The Cloudflare edge answers Let's Encrypt's validator with 403 (its bot protection), so the
certificate is ACME first with Caddy's own CA as the fallback issuer: the origin has a
certificate today, good enough for Cloudflare's "Full" mode, and every renewal tries Let's
Encrypt again. The box's address is kept out of the repository (`deploy.local`, git-ignored):
an origin address in a public README is an address to go round Cloudflare.

What is not done: a firewall (nothing but sshd, Caddy and the loopback app listen, so there is
little for one to do, but it is still owed), and Cloudflare's SSL mode is whatever the zone
defaults to — raising it to "Full" is a dashboard setting and encrypts the edge-to-origin leg.

### The night is four hours bare

Offline progress was capped at 12 h since Phase 0.5 and the lamps took it to 16/20/24 h for
5,000/25,000/100,000 gp — under an hour of income each, so a lamp was a formality. Now the
night is 4 h bare and the ladder is 8/16/24 h for 25,000/200,000/1,000,000 gp: the first an
evening of level-20 income, the last about a day of level-75 income. The night is the thing an
idle game sells, and it is now the thing the coins are for. The Second Look is 300,000 for the
same reason. Release from the oath stays at 100,000 doubling, which means the Phase 10 rule
"dearer than any one-time ware" no longer holds and its test is gone; changing gods is a
different kind of purchase and it still doubles. The watchtower's +2/4/6 h sit on top of
whichever lamp is lit, so a full hall sees 30 h.

### A room costs a week, and it costs everyone something

The Phase 12 costs were an hour, an afternoon and a day of one name's work, in three materials
a tier. The hall is meant to be the long goal, so each tier now asks for five to eight
different things and the totals are an evening (I, 3–5 h at level 20), a couple of days (II,
17–26 h at 55) and a week or more (III, 59–91 h at 80) of one name's work, pinned by test at
2.5–5 / 12–30 / 40–120 h; coins from 150,000 at tier II to 3,000,000 at tier III. Every tier
draws on at least four skills — wood, ore, bars, raw and cooked fish, offerings, ash from the
fire, and what the monsters drop: hides and pelts, bone, feathers, silk, venom, bat wings, a
hound's teeth, the minotaur's horns, rune stones. To price those, `hoursToMake` learned the
fight: the monster in an open zone that drops the thing fastest, in ladder gear, expected
units per kill. The audit test now checks the spread (five things, four skills, each tier more
than twice the units of the last, tier III at least five times tier II's coin) so a future
retune cannot quietly collapse a room back onto one skill.

## Phase 13 — the fire: talk

The request was a chat with other players and a room everyone is in. The shape: words live
in the register, not the save; a room (`fire`, and `wheel` for the next phase's table talk)
is heard by every name; a word to a name is between two; a name may turn away from another.

- **Long polling, not WebSockets or SSE.** The box sits behind Caddy behind Cloudflare, and
  the rule since Phase 11 is no new dependencies. A WebSocket needs an upgrade handler of
  its own and a proxy chain that honours it; an EventSource needs a response the whole chain
  flushes as it goes (Caddy's `encode` buffers, Cloudflare's free plan cuts a quiet response
  at 100 s). A long poll is one ordinary GET the register holds open until there is a word
  or 25 s pass — nothing between the browser and node has to know it is anything. One poll
  carries every talk: the reply is "every word newer than N that you can hear", and the tab
  sorts them. The cost is one open request per playing tab, which is what the fire is for.
  Who has a poll open right now is the nearest thing to presence and is shown as "N
  listening".
- **One poll per tab, in the hook, not the screen.** `useChat` runs in `Game` for as long as
  the tab leads, so the Talk row's unread count is right before the screen is ever opened,
  and a second screen (the wheel) can seat `ChatPanel` on the same state. Followers show
  their calm page and do not listen.
- **Ids only climb.** `messages.id` is AUTOINCREMENT so "newer than N" stays true after the
  month-old words in a room are swept. The reply's `latest` points past words the caller
  cannot hear (other people's talks, names turned from) so a quiet tab does not re-ask for
  them.
- **Reads are the register's.** `chat_reads` holds how far each name has read in each talk,
  so the unread counts survive a reload and agree between devices. The open talk tells the
  register its last word whenever it moves; a talk with a name is marked read when it is read
  in. A read never moves back.
- **Turning away is the only moderation.** A name turned away from has its room words hidden
  from you and its words to you refused with "That name has turned away." Nothing is deleted
  and the other name is not told beyond the refusal. There is no global mute; the words keep
  `from_id`, so one is possible later from the command line. Twenty words a minute a name,
  five hundred letters a word, control characters stripped and blank lines collapsed —
  `cleanWords` in the protocol so the screen can count what the register will.
- **What is trusted.** Less than the save: the register decides ids, times and who hears
  what; the client sends only where a word goes and what it says.
- No design screen; the talk is Screen A's rows and a card. The narrow layout (list or talk,
  a way back) is CSS only and was not checked in a browser this time — the window here would
  not resize.

## Phase 14 — the wheel: one table, turned by the register

The user asked for a gambling game, chose roulette, and then asked for it to be live — other
names betting on the same table — and for a chat on it. Coins inflate faster than xp past
level 80, so a house-edged sink was welcome; the user chose about 5% and no cap on a stake.
Built alongside Phase 13 in a worktree; the table talk is a room of that phase's chat.

### Why the pocket is the register's and the chips are too

A shared table means one spin for everyone, so the pocket cannot come from the sim's seeded
dice. The register draws it (`crypto.randomInt`) the moment bets close. But the register
cannot touch the coins in a browser's sim except by answering a save, and a bet wants to land
in a click, not a save. So coins become chips: _buy in_ is a sim command that takes coins
from the purse onto a cart in the save (`sim.wheel.cart`, ids from `sim.wheel.bought`, like
the hall's gifts); the next save write credits each unseen id once (`wheel_buyins` is the
ledger, `INSERT OR IGNORE`) and answers with what it took; bets are `POST /api/wheel/bet`
against the chips, one conditional `UPDATE … WHERE coins >= stake` that either lands or is
refused, and are final; settlement pays into the same chips. _Cash out_ moves the chips into
a numbered payout (`wheel_payouts.seq`), and the next save write adds every payout newer
than the save's `paidThrough` to the **stored** record's coins, stamps `paidThrough` and
`bought` into it, and echoes the payouts so the host adds them in memory. The invariant:
stored coins = what the save sent + every payout it had not taken; a tab that reloads onto
the stored record (stale write, a takeover that lapsed, a lost reply) is neither short nor
paid twice. A payout's number is floored at the stored save's `paidThrough`, so a ledger
restored from an older backup cannot hand out a number the save already took.

### The round is the clock

Round `n` is `[30n s, 30n+30 s)` of the register's clock, bets until `30n+24`; nothing runs on
a timer. Every look, bet and cash-out first settles whatever has closed, so a round a bet was
placed on is always drawn, however long ago, and a process down for it draws it on waking.
The strip of last pockets is backfilled lazily — the last twelve closed rounds only — so a
quiet night is not drawn round by round. The screen counts down on the register's clock
(`now` in every answer, offset kept by `useWheel`) and stops taking clicks 400 ms early, so
an honest click is never refused; one that is gets a quiet note. The pocket exists from the
close, so the last six seconds show it; the reveal is a gold ring, not a spinning wheel.

### Thirty-eight pockets

An American wheel — 0, 00, 1–36 — because the user asked for about 5% and that is what two
house pockets in thirty-eight are, on every bet alike (`src/sim/wheel.test.ts` pins it: stake
38 on any spot across every pocket and 36 × 38 comes back). Straight 35 to 1, a third or a
column 2 to 1, the rest even money; the house pockets beat every outside bet. A stack is a
chip of 100 to 1M gp per click, any number of clicks, no cap, as chosen.

### What is trusted

Bets, the pocket and the chips are the register's; the sim never learns a bet. Buy-ins are
trusted like gifts — the register takes the cart's word that the coins came out of a purse —
which is the save's own trust, no more.

### Flagged

- No design screen; the table is Screen A's card with a grid in it, the red/black are
  `--hurt` and the track, the house pockets the accent, a hit the gold ring.
- Every open wheel tab polls `/api/wheel` every 2 s while the screen is up. Fine for this
  hill; the chat's long poll is the pattern if it ever matters.
- The wheel turns only while someone is looking; a name that bets and leaves is paid when
  anyone next looks, or when they do.
- `npm run typecheck` fails on main in `server/chat.ts` (five `as MessageRow` casts under the
  node config) — Phase 13's, not this one's; `npm run build` checks the app config only.
