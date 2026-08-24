# Claude Design brief — idle RPG UI

Work through this in order. Don't jump ahead to the component library — we're going to
design real screens first and extract the library from them once we know what actually
holds up.

---

## Context

A browser-based idle/incremental RPG in the shape of Melvor Idle. Skills train on a timer,
the player has a bank of hundreds of items, combat resolves automatically, and sessions run
for hours in a background tab. Working title is a philosophy reference (Sisyphus-adjacent,
not finalised) — lean slightly austere and dry rather than high-fantasy.

Three things make this UI different from a normal web app:

1. **Density.** The bank screen shows 200+ item cells at once. Every design decision has to
   survive that.
2. **Numbers everywhere.** XP, levels, rates per hour, drop chances, timers. Tabular
   figures are non-negotiable — numbers must not jitter as they tick.
3. **Progress bars are the core visual motif.** Nearly every screen has at least one thing
   filling up. They deserve real design attention rather than being a default component.

## Hard constraint: the icon system

Item icons are monochrome SVGs (from game-icons.net) recoloured at runtime. An item's
appearance is derived from data, not authored. So the design system must define:

- **Material tier palettes** — bronze, iron, steel, mithril, adamant, rune, or whatever we
  land on. Each is primary / shadow / highlight. These have to read as distinct at 32px in
  a crowded grid, which is the real test.
- **Rarity treatments** — border, background, glow. Must layer on top of material colour
  without muddying it, and must not rely on colour alone.
- **Badge overlays** — small corner marks for enchantment, set membership, poison.

Design these as a system with a legible logic, not as one-off swatches. Show me the full
matrix of material x rarity at actual size so I can check it doesn't turn to soup.

## Phase 1 — three screens

Do one at a time and check in with me between each.

**Screen A: skill training (do this first — it's the densest).**
Active action with a progress bar, XP bar and level, rate per hour, the drop feed as items
land, the list of selectable actions with their level requirements (locked and unlocked
states), equipped tools, and the skill navigation. This is the screen players stare at for
hours. If the visual system works here it works everywhere.

**Screen B: bank / inventory.**
200+ items in a grid, with search, filtering, sorting, and category tabs. Item tooltips on
hover showing stats. Selection and multi-select. This is where the icon system gets stress
tested — show it populated with a realistic number of items, not eight.

**Screen C: combat.**
Player and enemy panels, health bars, the auto-resolving attack timers, a combat log,
loot drops. Needs to feel more urgent than screen A without breaking the same system.

## Phase 2 — the awkward states

These get skipped in most design work and then look broken in the product. I want them
designed properly:

- **Offline progress summary** — a modal shown on return: time elapsed, XP gained, items
  received, and an honest note when the catch-up was capped.
- **"Running in another tab"** — this game only runs in one tab at a time. The other tabs
  need a clear, calm screen explaining that, with a button to take over.
- Empty bank, level-up moment, inventory full, action interrupted, save error.

## Visual direction

- Dark theme, designed for multi-hour sessions — low contrast on chrome, high contrast on
  the numbers that matter. No pure black, no pure white text.
- Tight palette: one background family, one accent, plus the material tier colours (which
  are data, not decoration — keep them out of the UI chrome so they stay meaningful).
- Typography carries the aesthetic, since we have no illustration. Pick a UI face with real
  tabular numerals and show me the type scale.
- Restrained motion. Progress bars animate; nothing else should demand attention except
  rare drops and level-ups.
- Mobile matters — idle games get checked on a phone constantly. Show me how screen A
  reflows at ~390px.

## Phase 3 — extract the library

Only after the screens are settled. Pull out what we actually used:

- Tokens: colour (including material and rarity scales), type scale, spacing, radii,
  elevation, motion durations
- Components: progress bar variants, item cell, item tooltip, stat row, panel, tab bar,
  button variants, toast/drop notification, modal
- The states each component needs — locked, active, disabled, hover, selected

Give me the tokens as CSS custom properties and a TypeScript theme object, since this hands
off to Claude Code as the implementation. Keep application screens out of the library
itself — the library is tokens and primitives, the screens compose them.

## How to work

One phase at a time, checking in between. Ask me when a decision has real consequences
rather than picking silently. Where you make a call I should know about, say so and say why.
