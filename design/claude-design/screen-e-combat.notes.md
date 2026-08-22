# Screen E — Combat & Equipment (notes)

Source: `Screen E - Combat.dc.html` and `Screen E - Equipment.dc.html` in the Claude Design
project (synced 2026-08-22). Same shell as Screen A. Only the deltas and decisions are recorded.

## Combat

- Header: swords icon, "Combat", `Lv n / 99` chip, an `HP n` chip (the hitpoints level), xp/hr
  on the right; Screen A's XP row under it.
- Fight card, two columns: avatar letter / monster tile, name, sub (`you · Lv 12` /
  `Lv 5 · the lower slope`), a 16px hitpoints bar (hero: the accent gradient; monster:
  `#c96a5a`) with `7 / 10` at the right, a stats line (`atk · str · def` / `max hit n · n xp
  per kill`), a 5px gold swing-timer bar with `swings 2.4s`. Numbers pop over the bars
  (`floatUp` 1s): red for a hit, `#24272c`/`#67655e` for a miss ("0"), accent for a heal.
- Under the sides: `kill 14 · 2.1s this fight · 4 xp per kill` and STOP (hover `#c96a5a`).
- Idle: a dashed tile and "Not fighting. Pick a monster below."
- The design's `dead` state has a red banner ("you died · Hill Goat · 0 / 42 hp") with a
  WAKE AT THE CAMPFIRE button. **Not built as drawn** — per the instruction the banner names
  the worn item the hill took, and a NOTED button dismisses it; hitpoints refill on death.
- Food row: FOOD label, tile + name + `×31 · heals 3` (or `No food` in gold with "no food ·
  you will die at 0 hp"), a caret opening a FROM BANK menu (rows with EQUIPPED), `eat below
  25%`, an EAT button. Built as drawn; the threshold cycles 25 / 50 / 75 on click.
- Zones list: icon cell tinted by tier, name, `Lv 1 · dry line` (locked: `requires Lv 25` with
  a padlock), ACTIVE tag, caret; expanded rows per monster with a tinted tile, name,
  `Lv · hp · max hit · xp`, FIGHTING tag, and a FIGHT button on the selected row. Built as
  drawn; the shipped monsters have icons, so the letter tiles became icon tiles, and the row
  adds `~8.6s a kill` for the hero as they are now.
- Kill log column: KILL LOG / `n kills`, rare (epic purple) and legendary (gold) toasts, rows
  with a tile, name, `+xp`, a RARE tag, the items line (`Bone, Goat Hide, 2 gp`), age; a
  footer `kills · rares · session`. "rares" became "kinds" (distinct monsters) — the lifetime
  rare count the design implies would have counted mined gems too.
- New colour from this screen: `#c96a5a` → `--hurt`.

## Equipment

- Header: "Equipment", chip `5/7 worn · 5 tools`, and `sworn to Ashkar · +10% firemaking xp`
  on the right.
- WORN: a 3-column grid with areas `. head .` / `cape body neck` / `main legs off`; cells are
  square, dashed when empty, accent border when selected, label = last word of the item's name
  or the slot name. Totals under it: ATTACK / DEFENCE / XP BOOST. Built with the game's eleven
  body slots (two more rows: `hands feet ring` / `. ammo .`) and ATTACK / STRENGTH / DEFENCE —
  no item gives an xp boost yet.
- TOOLBELT ("one tool per skill, always with you"): rows with icon, name, `Skill · boon`, a
  tier tag. The design lists five tools (pick, axe, rod, tinderbox, hammer); the game has
  three slots and shows an empty row for each.
- SELECTED: big tile, name, `worn · body`, a stat block, an italic line, UNEQUIP → BANK or
  "nothing equipped here". Built as drawn, plus an IN THE BANK list with Equip for the
  selected slot.
