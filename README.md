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

## Layout

| Path            | Layer                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `src/sim/`      | Pure simulation: save schema, migrations, PRNG, actions, skills. No DOM.                          |
| `src/content/`  | Game content as JSON (skills, materials, rarities, items, rocks, drop tables), validated at load. |
| `src/runtime/`  | Browser orchestration: save store, leader election, channel, GameHost.                            |
| `src/ui/`       | React shell (thin).                                                                               |
| `src/icons/`    | Icon registry, SVG renderer + cache, badge glyphs, procedural sword geometry.                     |
| `src/ui/theme/` | Design tokens (CSS custom properties + TS object) and fonts.                                      |
| `src/ui/items/` | Maps content onto renderer specs; `<ItemTile>` / `<BareIcon>`.                                    |
| `design/`       | Claude Design reference screens the tokens were extracted from.                                   |
| `scripts/`      | Icon vendoring / indexing pipeline.                                                               |

## Commands

| Command                                 | What it does                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Vite dev server. Game at `/`, icon browser at `/dev/icons.html`, item contact sheet at `/dev/items.html`. |
| `npm run build`                         | Typecheck + production build (game entry only).                                                           |
| `npm test`                              | Vitest, single run.                                                                                       |
| `npm run typecheck` / `lint` / `format` | The usual.                                                                                                |
| `npm run icons:vendor -- --refresh`     | Re-fetch `vendor/game-icons` (checked in) at the commit pinned in `scripts/game-icons.lock.json`.         |
| `npm run icons:index`                   | Rebuild `src/assets/icon-index.json` from the vendored SVGs.                                              |
| `npm run icons:ship`                    | Rebuild the shipped icon subset and `ATTRIBUTION.md` (runs automatically before `dev`/`build`).           |

## Icons

All icons come from [game-icons.net](https://game-icons.net) (CC BY 3.0 / CC0). Icon ids are
`author/slug`, e.g. `lorc/broadsword`. To ship a new icon, reference it from content (`"icon": "…"`)
or add it to `content/icon-manifest.json`; `ATTRIBUTION.md` is regenerated from what ships.
Curated search tags live in `content/icon-tags.json`.
