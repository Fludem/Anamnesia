# Claude Design brief — Screen F: the Trader

Same project, same library, same shell as Screens A–E. This is one screen, not a phase:
design it, check in, and we'll hand it back to code.

---

## Context

The game is live and the Trader has been in it since Phase 10, but it was built without a
mock — it is Screen A's action rows with a price and a Buy on the right, and Screen E's
two-column layout with the ferryman's terms down the side. It works; it does not look
designed. I want the real screen.

What the Trader is for: this is the game's coin sink. Coins come in by the sackful (selling
is frictionless, income runs from ~10k gp/h at level 1 to over a million an hour at the top)
and there was nothing to spend them on. The Trader sells the one thing an idle game actually
has to sell — **the night**: how many hours of offline progress count when you come back.
Bare, the night is 4 hours. A lamp makes it 8, oil 16, a long wick 24. Everything else on
the screen is a footnote to that.

Tone: the hill is austere and dry. The Trader is not a shopkeeper with a grin. Every ware has
one line of copy, already written; keep the lines, design around them.

## What's on the screen

### Header

Screen A's header shape. Scales icon (`lorc/scales`, the nav icon), **Trader**, one chip
reading `the night lasts 8 h` (this is the live total — lamp plus whatever the hall's
watchtower adds), and the hero's coins on the right (`123,456 gp`). No XP row; the Trader
is not a skill.

### The wares (main column)

Five things, in this order. Prices are in gp, rounded to 10; "line" is the copy that ships.

| Ware                  | Icon                    | Price        | Effect                                      | Line                                                                 |
| --------------------- | ----------------------- | ------------ | ------------------------------------------- | -------------------------------------------------------------------- |
| A Lamp                | `lorc/lantern`          | 25,000       | the night lasts 8 h (from 4)                | Four hours of night become eight. The hill does not notice.          |
| Oil for the Lamp      | `delapouite/oil-can`    | 200,000      | 16 h · needs A Lamp                         | Sixteen hours. It smells of fish, because it is.                     |
| A Long Wick           | `lorc/candle-flame`     | 1,000,000    | 24 h · needs Oil for the Lamp               | A whole day, lit. Nobody has asked for more.                         |
| A Second Look         | `lorc/semi-closed-eye`  | 300,000      | skill capes turn up twice as often          | You start checking the ground twice. Twice the capes, the same ground. |
| Release from the Oath | `lorc/crossed-chains`   | 100,000, ×2 each time | unswear your god; favour is kept; repeatable | The gods let go, for a price. It doubles each time; they remember.   |

For scale: a Lamp is an evening of level-20 income; the Long Wick is about a day of
level-75 income. These are purchases, not milestones — a player buys each one once, and the
moment should feel like spending, not like a level-up.

The first three are a **ladder** — one rung unlocks the next, and owning a higher rung makes
the lower ones irrelevant. Design the ladder as a ladder if that reads better than three
rows; the build shows three rows and it's fine but flat.

Each ware row carries three lines of text: the name, the line, and an **effect line** that
changes with state —

- for sale: `offline progress counts for 8 h instead of 4`
- owned: `the night lasts 8 h`
- Second Look for sale / owned: `skill capes turn up twice as often` / `the hill leaves twice as much`
- Release, not sworn: `sworn to nobody`; sworn, never released: `swear to another god; favour is kept`; released before: `released 2× · favour is kept`

Under the card title the build has a hint: _The Trader comes up when it suits. The prices do
not move._ Keep or cut; the second sentence is a lie for the Oath.

### Ware states — each one needs a look

1. **For sale, affordable** — price in gold tabular mono, a Buy button in the accent.
2. **For sale, can't afford** — same row, price dimmed (`--fg-3`), Buy disabled. This is the
   state most players will stare at for hours; it has to read as "not yet", not "broken".
   Consider showing the gap, or how far the coins have got — that's the progress-bar motif
   and this screen has none.
3. **Locked** — the rung above the one you own. No price, a padlock and `after A Lamp` in
   gold, tile dimmed. Same treatment as Screen A's locked veins.
4. **Owned** — an OWNED tag beside the name, tile border in the accent, no price, no button.
   Once owned the row is a record, not an offer.
5. **Repeatable** (Release only) — owned and for sale at once: shows how many times it's been
   bought, and the doubled price for the next.

### The buy moment

No confirmation dialog today: click Buy, the coins drop, a gold `−25,000 gp` floats up over
the card (Screen A's number pop), the row flips to owned, the header chip updates. That
should stay instant for the lamps. **Open question for you:** Release from the Oath sends
the hero straight to the choose-your-god page and costs 100k doubling — does that one earn a
confirm? Say what you'd do and why.

### The Ferryman (side column)

Not a ware — he isn't for sale and the card says so. When the hero dies, one worn item is
rolled; the ferryman keeps it on you for **twice what it's worth**, or an obol from the bank
settles it outright. The card repeats the terms and shows what's at stake right now:

- Icon `lorc/crown-coin`, label THE FERRYMAN, hint `not for sale`
- Flavour: _He charges 2× what the thing is worth, and the thing stays on. An obol settles it
  outright. Tell him no on the fight screen._
- Stat rows: `paying` yes/no (accent when yes) · `obols in the bank` n (gold when > 0) ·
  `a death could cost` `up to 91,000 gp` (gold) or `nothing worn` · `for the` Aether Cuirass
- Footer, when there has been a death: `last time · the ferryman took 1,330 gp for your Silver
  Sword` / `an obol paid the ferryman · your Silver Sword stays` / `the hill took your …`

The pay/don't-pay toggle lives on the Combat screen (a row under the fight card, "Paying the
ferryman" / "Pay him" / "Stop paying"). **Open question:** should the toggle also be here,
on the card that explains the terms? The build sends you to the fight screen for it.

### Spent (side column)

A small ledger: `coins ever spent` · `crossings paid` · `bank slots bought`. Bank slots are
bought from the bank's `+` cell (Screen C), not here — it stays there; this just counts them.

## Constraints

- **Same system.** Tokens and components from the library. Gold (`--gold`) is for prices and
  the ferryman's numbers; the accent is for Buy and anything owned; `--hurt` doesn't belong
  on this screen. Material tier colours stay out of it entirely — nothing here is an item.
- **Icons are monochrome game-icons SVGs** in the standard tile box, recoloured at runtime.
  The ids above are what ships; if you'd rather a different glyph say which and I'll check
  the set has it.
- **Numbers don't jitter.** Prices and the coin total are tabular mono. The coin total ticks
  while a fight or a skill runs in the background.
- **~390px.** The build wraps each ware row so the price + Buy cell drops to its own line,
  right-aligned, and the side column stacks under the wares. Show me the reflow.
- Dark, calm, no illustration. Nothing animates except the buy pop.

## What I want back

1. The Trader at desktop width, populated as a mid-game hero: Lamp owned, Oil for sale and
   not affordable (say 140,000 of 200,000 gp), Long Wick locked, Second Look affordable,
   Release sworn-never-released, one past death in the ferryman footer, 3 obols in the bank.
2. The same at ~390px.
3. The five ware states side by side, and the buy moment (before / pop / after).
4. Your answers to the two open questions, and anything the lamp ladder wants that the
   row list isn't giving it.

Check in after 1 before doing the rest.
