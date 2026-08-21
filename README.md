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

## Layout

| Path           | Layer                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| `src/sim/`     | Pure simulation: save schema, migrations, PRNG, actions, skills. No DOM.     |
| `src/content/` | Game content as JSON (skills, items, rocks, drop tables), validated at load. |
| `src/runtime/` | Browser orchestration: save store, leader election, channel, GameHost.       |
| `src/ui/`      | React shell (thin).                                                          |
| `src/icons/`   | Icon registry and `<Icon>`.                                                  |
| `scripts/`     | Icon vendoring / indexing pipeline.                                          |

## Commands

| Command                                 | What it does                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Vite dev server. Game at `/`, dev icon browser at `/dev/icons.html`.                            |
| `npm run build`                         | Typecheck + production build (game entry only).                                                 |
| `npm test`                              | Vitest, single run.                                                                             |
| `npm run typecheck` / `lint` / `format` | The usual.                                                                                      |
| `npm run icons:vendor`                  | Clone game-icons into `vendor/` at the commit pinned in `scripts/game-icons.lock.json`.         |
| `npm run icons:index`                   | Rebuild `src/assets/icon-index.json` from the vendored SVGs (needs `icons:vendor`).             |
| `npm run icons:ship`                    | Rebuild the shipped icon subset and `ATTRIBUTION.md` (runs automatically before `dev`/`build`). |

## Icons

All icons come from [game-icons.net](https://game-icons.net) (CC BY 3.0 / CC0). Icon ids are
`author/slug`, e.g. `lorc/broadsword`. To ship a new icon, reference it from content (`"icon": "…"`)
or add it to `content/icon-manifest.json`; `ATTRIBUTION.md` is regenerated from what ships.
Curated search tags live in `content/icon-tags.json`.
