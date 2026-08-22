# Anamnesia Idle

A browser idle RPG (Melvor-shaped) with a generated item and icon pipeline. See `BRIEF.md` for
the project brief and `DECISIONS.md` for the why behind non-obvious choices.

Phase 0.5 is in: exactly one tab runs the simulation (Web Locks leader election), followers mirror
it over a BroadcastChannel, every save is guarded by a compare-and-swap on `saveCounter` in
IndexedDB, and offline progress is derived from timestamps, capped at 12 h, and idempotent.

Phase 1 is in: a real save shape (player, skills, inventory, equipment, bank, action queue), a
swappable XP curve, content as validated JSON, a single action primitive (duration in ticks,
success roll, outcome), and mining end to end with tests that pin exact XP and drop results from
fixed seeds.

Phase 2 is in: an item's icon is derived, not authored. Design tokens come from the Claude Design
screens in `design/claude-design/`; material palettes and rarities are content; a renderer
composes inline SVG from icon geometry + material gradient + rarity treatment + corner badges;
swords are generated from seeded parts whose stats match their shape; rendered markup is cached
by its inputs. `/dev/items.html` is the contact sheet.

Phase 3 is in: the content. Setting and tone are the hill — plain material words, one dry line
each (see DECISIONS.md). Seven veins, six trees, 65 smithing recipes across a six-tier equipment
ladder, five combat zones with 21 monsters (data only until the combat loop), 110 items, four
rarities. Mining, woodcutting and smithing are playable end to end; tools equip into per-skill
slots and shorten actions; containers open. A content audit test checks that everything is
obtainable, the economy never destroys value, and names and descriptions keep the house style.

Phase 4 is in: the UI, built from the Claude Design screens. Sidebar (or top bar + bottom tabs
under 700px), a skill screen per gathering skill with the active action, its progress bar, xp
pops, the node list and the drop feed; smithing on the same skeleton; the bank with filters,
search, selection, sell, open, equip and purchasable slots; first-run naming; the level-up
moment, the rare-drop toast, the offline recap (honest about the cap) and the calm full-page
states for other-tab / catching-up / stale / save-error. Save v4 adds coins, bank slots, an
event log and action counters to carry it. Combat is still data only.

Phase 5 is in: the rest of Screen D's onboarding (choose a god, the ready card), four gods whose
boons are data, three more skills — fishing, firemaking, cooking — that feed and gate each other
(smithing makes rods from bars and logs; cooking wants a hotter fire; fires eat logs), a "quick"
method in every gathering skill that out-earns its tier and banks nothing worth keeping, ten
first steps checked by the sim with small rewards, and a progression model (`src/sim/progression.ts`)
pinned by a test so every skill takes 27–45 hours of its own idle time to 99 and the mean sits
near 36. Save v5 adds the sworn god, lifetime counters, first-steps progress and the rod slot.

Phase 6 is in: combat, from the design's Screen E. A fight is an action whose cycle is the
hero's swing, with the monster on its own clock; one combat skill plus an unlisted hitpoints
skill; xp paid per point of damage; food chosen from the bank and eaten automatically below a
threshold; death destroys one random worn body item (never a tool) and nothing else. The
combat screen (fight card, food row, zones and monsters, kill log) and an equipment screen
(worn grid, toolbelt, selected item, equip from the bank). The progression model gained a
combat climb in ladder gear, and `scripts/tune-combat.ts` retunes monster hp/xp against it.
Save v6 adds the combat state and kill/death counters.

Phase 7 is in: the gods fight too. A fourth gathering skill, Foraging (by hand, no tool),
gathers offerings over patches; each god has a combat boon as content — Tharok's Stone Skin,
Vessith's Green Return, Maren's Still Hand, Ashkar's Ember — that runs on favour, which burns
one a second in a fight and is bought back by burning the chosen offering from the bank, the
same shape as food. First steps gains a combat step, a foraging step and an offering. The
progression model measures every boon (`scripts/tune-boons.ts` prints the comparison) and a
test pins them to about the same worth. Save v7 adds the offering, favour and a burnt counter.

Phase 8 fills the empty slots. Gauntlets are smithed like the rest of the set; capes carry an
xp boost as the design pictured — one per skill, found rarely while working it, plus beast
capes with combat stats from the monsters that wore the hide; javelins go in the ammo slot,
twenty to the bar, one thrown from the bank with every swing that lands; rings and necks run
from copper to aether. `scripts/tune-gear.ts` prints what javelins buy and cost. Save v8 adds
a thrown counter.

Phase 9 is in: highscores for every skill, total level and wealth — the hero's standing on
every board, and the chosen board best first. Until Phase 11 the other names were curves;
now they are players.

Phase 11 is in: the hill has a register. A name and a password make an account (`server/`,
node's own HTTP server and SQLite, no new dependencies); the save lives on the server and
travels between browsers and devices through the same compare-and-swap the tabs already
used; the highscores rank every account's last save. In dev the API mounts inside Vite, so
`npm run dev` is still the whole game; in production `npm run build && npm start` serves the
game and the API from one port. The NPC roster is gone.

Phase 10 is the coin sink. The ferryman: when the hero falls, an obol in the bank settles the
crossing, else twice the lost item's worth in coins if the hero pays him (on by default), else
the item goes as before — the one price that tracks the gear. The trader, a new screen, sells
what the hill will take coins for: a lamp ladder that lengthens the offline cap (16, 20,
24 h), a second look that doubles finds, and release from the oath from 100,000 gp doubling.
`src/sim/progression.ts` gained `coinsPerHour`; `scripts/tune-trader.ts` prints income by
level, each ware as hours of work and the ferryman's fee per tier. Save v9 adds purchases, the
ferryman setting and spent/ferried counters.

## Layout

| Path            | Layer                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sim/`      | Pure simulation: save schema, migrations, PRNG, actions, skills, `highscores.ts` (what a standing is). No DOM.                                                                                                                            |
| `src/content/`  | Game content as JSON (skills, gods, materials, rarities, items, rocks, trees, waters, recipes, zones, monsters, drop tables), validated at load; `progression.test.ts` pins hours-to-99.                                                  |
| `src/runtime/`  | Browser orchestration: save stores (IndexedDB and the server), leader election, channel, GameHost.                                                                                                                                        |
| `src/api/`      | The wire: `protocol.ts` (zod schemas both ends import) and `client.ts` (the game's calls).                                                                                                                                                |
| `server/`       | The register: `db.ts` (SQLite schema), `auth.ts` (scrypt, sessions, cookies, rate limits), `register.ts` (SQL), `app.ts` (routes + static files), `main.ts` (production), `vite.ts` (dev).                                                |
| `src/ui/`       | React: `Shell`, `screens/`, `overlays/`, `derive.ts` (pure view helpers), `app.css` (the design's classes over the tokens).                                                                                                               |
| `src/icons/`    | Icon registry, SVG renderer + cache, badge glyphs, procedural sword geometry.                                                                                                                                                             |
| `src/ui/theme/` | Design tokens (CSS custom properties + TS object) and fonts.                                                                                                                                                                              |
| `src/ui/items/` | Maps content onto renderer specs; `<ItemTile>` / `<BareIcon>`.                                                                                                                                                                            |
| `design/`       | Claude Design reference screens the tokens were extracted from.                                                                                                                                                                           |
| `scripts/`      | Icon vendoring / indexing pipeline; `tune-combat.ts` retunes monsters against the progression model; `tune-boons.ts` compares the gods' boons; `tune-gear.ts` prices javelins; `tune-trader.ts` prices the trader's wares against income. |

## Commands

| Command                                 | What it does                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Vite dev server with the API mounted (register in `data/dev.sqlite`). Game at `/`, icon browser at `/dev/icons.html`, item contact sheet at `/dev/items.html`. |
| `npm run build`                         | Typecheck + production build of the game (`dist/`) and the server (`dist-server/main.js`).                                                                     |
| `npm start`                             | Serve `dist/` and the API from one port. `PORT` (8787), `ANAMNESIA_DB` (`data/anamnesia.sqlite`), `ANAMNESIA_STATIC` (`dist`). Needs Node 24+.                 |
| `npx tsx scripts/reset-password.ts`     | Change a name's password from the command line; there is no email, so this is the only way back.                                                               |
| `npm test`                              | Vitest, single run.                                                                                                                                            |
| `npm run typecheck` / `lint` / `format` | The usual.                                                                                                                                                     |
| `npm run icons:vendor -- --refresh`     | Re-fetch `vendor/game-icons` (checked in) at the commit pinned in `scripts/game-icons.lock.json`.                                                              |
| `npm run icons:index`                   | Rebuild `src/assets/icon-index.json` from the vendored SVGs.                                                                                                   |
| `npm run icons:ship`                    | Rebuild the shipped icon subset and `ATTRIBUTION.md` (runs automatically before `dev`/`build`).                                                                |

## Icons

All icons come from [game-icons.net](https://game-icons.net) (CC BY 3.0 / CC0). Icon ids are
`author/slug`, e.g. `lorc/broadsword`. To ship a new icon, reference it from content (`"icon": "…"`)
or add it to `content/icon-manifest.json`; `ATTRIBUTION.md` is regenerated from what ships.
Curated search tags live in `content/icon-tags.json`.
