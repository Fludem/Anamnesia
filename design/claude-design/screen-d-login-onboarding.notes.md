# Screen D — Login & Onboarding (notes)

Source: `Screen D - Login & Onboarding.dc.html` in the Claude Design project (read 2026-08-22;
the synced file ends mid-way through the first onboarding step, so only what it contains is
recorded here).

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
  note "3–16 characters. Choose wisely — renames cost 50,000 gp."

## What the implementation does with it

The game has no accounts, so login/register are not built (see DECISIONS.md, Phase 4). The
onboarding card is the first-run screen and the same card carries every calm full-page state
(follower, catching up, stale, save error). Copy was re-voiced for the hill ("the realm" →
"the hill"; renames are free, from settings).
