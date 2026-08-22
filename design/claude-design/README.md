# Claude Design reference screens

Source: Claude Design project `a57b0fae-6fbf-4c20-9a03-e6748ed50d55` (the user's), synced
2026-08-22. These are the design-library sample pages Phase 2+ is built on. They are kept (Prettier-formatted,
otherwise unchanged) as reference; `support.js` (the Claude Design runtime) is not included, so they do not
run standalone — read them for tokens, layout and behaviour.

- `screen-a-skill-training.html` — mining: active action, XP bar, veins list, drop feed, level-up, offline recap
- `screen-b-woodcutting.notes.md` — same layout as A for a second skill; only the data deltas are recorded
- `screen-c-bank.html` — bank grid with rarity cells, filters, search, sell, openable containers
- `screen-d-login-onboarding.notes.md` — login / register / name-your-hero card; only the
  onboarding card is built (no accounts yet)
- `screen-e-combat.notes.md` — combat (fight card, food, zones, kill log) and equipment
  (worn grid, toolbelt, selected item); deltas from the build recorded
- `badges/*.svg` — corner-badge glyphs drawn in the design project (not from game-icons)

The extracted tokens live in `src/ui/theme/` and the material / rarity palettes in
`src/content/materials.json` and `src/content/rarities.json`.
