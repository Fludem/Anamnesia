# Claude Design brief — Screen H: the Wheel

Same project, same library, same shell as Screens A–G. One screen and one modal; design it,
check in after the first frame, and we'll hand it back to code.

---

## Context

The wheel is the hill's roulette table — **one table for everyone**, live since Phase 14,
turned by the register's clock every thirty seconds whether anyone is watching or not.
Built with no mock: Screen A's rows, Screen E's columns, a CSS-grid table. It works; it is
the most visually naked screen in the game and the one that most obviously wants design.

The rules, fixed: a round is 30 seconds — bets are taken for 24, then the wheel turns and
the pocket shows until the next round opens. An American wheel: 38 pockets, 0 and 00
belong to the house, so the house keeps two in thirty-eight (5.26%) on every spot. Coins
become chips only here: a buy-in rides out with the save, bets are final the moment they
land, a cash-out comes home with the next save. Everyone on the hill bets on the *same*
round and sees each other's chips land.

Tone: austere and dry, which for a casino means **understatement is the design**. No neon,
no felt-green kitsch, no bouncing ball. The register draws a number and posts it; the
drama is the countdown and other people's chips, not fanfare.

## What's on the screen

### Header

Cartwheel icon (`lorc/cartwheel`, the nav icon), **The Wheel**, and the chip carries the
round's phase — it changes every second and is the screen's heartbeat:

- `bets close in 12 s`
- `the wheel turns`
- `17 · next spin in 4 s` (the pocket just drawn)

Rate slot: `34,000 gp at the table` (this name's chips). No XP row.

### The table (main column)

One card. Head: **The table**, hint `1,200 gp down this spin` / `nothing down this spin`.
The whole card visibly **closes** when bets aren't being taken.

The layout, fixed by the game:

- A house column: `0` and `00`.
- The number grid: three rows of twelve (top row 3, 6, 9…36; middle 2, 5…35; bottom
  1, 4…34), each row ending in its `2:1` column bet.
- Two outside rows beneath: `1st 12 · 2nd 12 · 3rd 12`, then `1–18 · even · red · black ·
  odd · high`.

Every spot is a button. On it:

- The label, always — colour is never the only signal.
- **The chips down**, as a stack showing the total in short form (`1.5k`, `20k`, `2M`).
  One stack per spot for *everyone's* chips, with **mine distinguishable at a glance** —
  today a tint; you may do better. This is the social heart of the screen: watching a
  stranger's stack land on black while yours sits on 17.
- A tooltip that ships: `17 · 1,000 pays 36,000`.
- When the pocket shows, the **hit** spot lights; everything else stands down.

Under the table, the chip row: `a chip is` `100 · 1k · 10k · 100k · 1M` — the stake one
click places; values above the purse are disabled. Then the strip: `last spins` — the last
twelve pockets as small tokens, newest first, red/black/house.

Placing a bet is one click on a spot — no confirm, final, the purse drops. Buying in pops
a gold `−10,000 gp` (Screen A's pop).

### Your chips (side column)

Flavour, ships as is: _Coins become chips here and nowhere else. The house keeps two
pockets in thirty-eight; the rest is the wheel's to give._

Stat rows: `at the table` `34,000 gp` (gold when > 0) · `being counted` `10,000 gp` (only
while a buy-in rides the save, a ~15 s state) · `ever staked` `120,000 gp` · `ever taken
back` `96,500 gp` (accent only when ahead — most names won't be; the row is quietly honest).

Buttons: **Buy in…** (primary) · **Cash out** (gold, disabled at 0 chips).

### At the table (side column)

Who has chips down this round: likeness disc (18px), name, gp down; the player's own row
marked. Hint `3 names` / `nobody yet`. Footer, the last spin's story in one line (shipped
copy): `last spin · 17 black · Ann took 450 for 140 · Bea lost 250` — the forms are
`took X for Y` / `broke even` / `lost X` / `nobody had a bet down`.

### Table talk (side column)

The chat panel, titled **Table talk** — the wheel's own room of the hill's chat. It's the
same component the fire uses; it needs a home here, not a redesign.

### The buy-in modal

Title **Buy in**. Copy ships: _210,450 gp in the purse. What goes to the table comes back
only by cashing out, and only as much as the wheel left._ Amount input, chips `1k · 10k ·
100k · 1M · ALL`, total line `= 10,000 gp to the table`, Cancel / **Buy in**.

## The round as a design object

The screen's real subject is the 30-second loop. Three phases, and the transitions between
them are the design moment:

1. **Open** (24 s) — the table takes clicks, the countdown runs. The register's clock, not
   this tab's; the build refuses clicks in the last 400 ms so an honest click is never
   eaten. Design the closing seconds so nobody feels robbed — the countdown must be
   legible at a glance from across the screen.
2. **Turning** (an instant to a few seconds) — bets closed, pocket not yet shown. Today:
   nothing. There is **no wheel graphic anywhere** and no ball; the number simply appears.
3. **Shown** (until the round ends) — the pocket in the chip (`17 · next spin in 4 s`),
   the hit spot lit, winners paid silently into their chip totals.

**The central open question of this brief:** does the turning/reveal moment want anything?
A physical wheel animation is off the table tonally and practically (the draw is instant
server-side; the phase can be near zero seconds). But between "nothing happens" and
"casino" there is a spectrum — a beat on the strip, the hit pocket arriving with weight, a
brief hush on the table. Say what the reveal should be and how it degrades when the phase
lasts 0 s.

## States that need a look

- **Open, chips down** — the main populated frame.
- **Open, no chips** — purse 0: every spot disabled; **Buy in…** is the screen's one call
  to action and should read as such.
- **Closed** (turning/shown) — the table not taking clicks without looking broken.
- **The hit** — pocket lit, the strip gaining a token.
- **Empty table** — `nobody yet`, no stacks, strip `none yet`: 3 a.m. on the hill.
- **Reading the register / unreachable** — the standing quiet warn note.

## Constraints

- **Same system.** Tokens and components from the library. Red and black pockets need
  design-sanctioned colours — the palette's only red today is `--hurt`, and black-on-dark
  is its own problem; solve both within the system and never rely on colour alone (labels
  always show). House pockets (0/00) get a third treatment. Gold stays for coins and
  Cash out; the accent for Buy in and "ahead".
- **Numbers don't jitter.** The countdown, stacks and purse are tabular mono; the purse in
  the sidebar ticks while skills run in the background.
- **The table is a grid of buttons** — fifteen columns with the house and 2:1 cells. It
  must stay clickable at every size; spots are targets first, decoration second.
- **~390px.** The hard case of the whole game: the grid, the chip row, the strip, then the
  side cards stacking under, chat last. The build shrinks the grid to fit; if the table
  should instead scroll, or rotate priorities (outside bets above the grid on narrow?),
  say so and show it.
- Nothing animates but the countdown, the hit, and the buy-in pop.

## Open questions

1. **The reveal** — see above. This is the one I most want your answer on.
2. **Chips as objects.** Stacks are text (`1.5k`) on a tinted corner today. Do chips want
   to be drawn — a disc with a figure, mine vs everyone layered — and does that survive
   twelve names betting at once on one spot?
3. **Red and black.** Show me the pocket palette against the dark chrome, in the grid and
   in the strip, with the colourblind story.
4. **The strip.** Twelve plain tokens today. Worth any more — house pockets marked,
   a longest-absent hint — or is more information the wrong tone for a 5.26% house edge?

## What I want back

1. The Wheel at desktop width, mid-round, populated: bets close in 9 s; the player has
   1,200 gp down (1k on 17, 100 on red, 100 on `2nd 12`); two other names at the table with
   stacks on black, 22, and `column:3`; strip of eight past pockets including one house;
   purse `34,000 gp at the table`, `ever taken back` behind `ever staked`; a live line or
   two in Table talk.
2. The three phases of the same round side by side (open / turning / shown-with-hit).
3. Open-with-no-chips, and the empty 3 a.m. table.
4. The buy-in modal.
5. ~390px of frame 1.
6. Answers to the four questions.

Check in after 1 before doing the rest.
