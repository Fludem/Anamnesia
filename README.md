# Anamnesia Idle

A browser idle RPG (Melvor-shaped) with a generated item and icon pipeline. See `BRIEF.md` for the project brief and `DECISIONS.md` for the why behind
non-obvious choices.

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
