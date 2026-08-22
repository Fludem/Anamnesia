# Screen B — Woodcutting (data deltas only)

Same layout as Screen A. Source: `Screen B - Woodcutting.dc.html` in the Claude Design project
(synced 2026-08-22). Only the data that differs from Screen A is recorded here.

## Trees (the "veins" list)

| name             | tier   | icon (design)  | req | xp  | dur  |
| ---------------- | ------ | -------------- | --- | --- | ---- |
| Pine Stand       | pine   | pine-tree      | 1   | 14  | 2.4s |
| Oak Grove        | oak    | oak            | 12  | 28  | 2.8s |
| Birch Thicket    | birch  | birch-trees    | 24  | 40  | 2.9s |
| Willow Grove     | willow | willow-tree    | 35  | 52  | 3.0s |
| Blightwood Copse | blight | dead-wood      | 52  | 96  | 3.6s |
| Hollow Elder     | elder  | evil-tree      | 78  | 185 | 4.4s |

`elder` uses the aether palette (`#c9a4ff / #8f63e8 / #53398f`); `nest` uses the gem palette.

## Drops

- Common: Willow Logs (`log`, willow tier).
- Rare (rate/1): Bird's Nest (`nest-eggs`, gem/"nest" palette) — openable container in Screen C
  (`NEST_LOOT`: acorn 40 ×1–3, pine-seed 30 ×1–2, willow-seed 20, maple-seed 10).
- Epic (rate/4): Aether Leaf (`curled-leaf`, aether/"elder" palette) — triggers the RARE DROP toast.

## Tool row

"TOOL · Iron Axe · −10% action time" — `wood-axe` icon in the iron tier.

## Level-up unlock copy

- 38: "Bird's nest chance +0.5%"
- 39: "New grove surveyed: Teak Stand"
- 40: "Willow yield +1"
- otherwise: "Next: Lv N · X xp"

## Palettes used

pine, oak, birch, willow, blight, elder(=aether), nest(=gem), iron — all in `src/content/materials.json`.
