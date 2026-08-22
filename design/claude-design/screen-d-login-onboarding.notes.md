# Screen D — Login & Onboarding (notes)

Source: `Screen D - Login & Onboarding.dc.html` in the Claude Design project (re-read
2026-08-22 after the user updated it; the full three-step onboarding is now recorded).

## Layout

Full-page centred card (max 400px, `#17181b`, 1px `#24272c`, radius 10, 26px padding, shadow
`0 18px 50px rgba(0,0,0,.45)`) on the page background, under a centred wordmark (ANAMNESIA
22px/.22em, IDLE 11px mono/.5em). Four faint game-icon silhouettes drift behind it
(rune-stone 150px, pine-tree 170px, mining 90px, campfire 80px; `#1b1e22` / `#191c20`;
`drift` keyframes 8–11s). Card content uses `fadeSlide .3s`.

## States

- **Login** — "Welcome back" / "Your skills kept training while you were gone." Email +
  password fields (`#101214` bg, `#24272c` border, radius 6, 10×12 padding, mono 13px; focus
  border `#3a5f50`), "Forgot password?", solid accent button "ENTER THE REALM" (`#56c39a` bg,
  `#0e1512` text, mono 600 12px/.14em, hover `#74dcb4`), divider "NEW HERE?", ghost button
  "CREATE A CHARACTER".
- **Register** — "Create a character" / "One account. A lifetime of grinding." Email, password
  ("8+ characters"), confirm; "BEGIN THE JOURNEY"; "Already have a character? Log in".
- **Onboarding** — step dots row with a "step N" caption; step 1 "Name your hero" / "This is
  what the realm will call you.": 52px round avatar showing the first letter (accent, mono
  600 20px) beside the name input (mono 500 14px, maxLength 16, placeholder "e.g. Fludem");
  note "3–16 characters. Choose wisely — renames cost 50,000 gp."; step dots are 8px discs,
  the current one a 22px pill, done/current accent and pending `#2c2f35`, with "STEP n / 3".
- **Step 2 — "Choose your god"** / "Devotion has perks. Pick who you kneel to." Four rows
  (`#101214` bg, 1px `#24272c`, radius 7, 9×12 padding; picked: border
  `rgba(86,195,154,.45)`): 38px icon tile (icon accent when picked, `#8b887f` otherwise), name
  (sans 600 13px) with the epithet beside it (mono 9px `#67655e` .1em), a line (mono 10px
  `#67655e`), the boon in accent (mono 500 10px), and a SWORN tag on the picked row. BACK
  (ghost) + CONTINUE (solid, flex 1).
  - Tharok the Deep Delver · rune-stone · "God of stone, ore, and stubbornness." ·
    "+10% Mining & Smithing xp"
  - Vessith the Verdant · sprout · "Goddess of growth and green things." ·
    "+10% Woodcutting xp · rare seed drops"
  - Maren of the Still Water · fishing · "Goddess of tides, patience, and lunch." ·
    "+10% Fishing xp · +5% double catch"
  - Ashkar the Everburning · campfire · "God of flame and poor impulse control." ·
    "+10% Firemaking & Cooking xp"
- **Step 3 — ready** — 64px round tile with the chosen god's icon in accent, "{name}, sworn to
  {god}", "The grind continues even when you close the tab. / Come back to loot, levels, and a
  smug feeling.", three hint rows with gold icons (hourglass "Skills train offline, up to 12h
  at a time"; chest "Everything you gather lands in your bank"; coins "Sell loot for gp · buy
  better tools"), solid "START GRINDING", a "Back" link.

## What the implementation does with it

The game has no accounts, so login/register are not built (see DECISIONS.md, Phase 4). The
onboarding card is the first-run screen and the same card carries every calm full-page state
(follower, catching up, stale, save error). Copy was re-voiced for the hill ("the realm" →
"the hill"; renames are free, from settings). Phase 5 built steps 2 and 3 as drawn: the gods
are content (`src/content/gods.json`) with the design's copy verbatim and real perks; the ready
card's button reads "Start the climb" and its third hint "smith better tools" (there is no
shop).
