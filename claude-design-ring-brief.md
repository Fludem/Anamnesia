# Claude Design brief — Screen I: the ring

Same project, same library, same shell as Screens A–H. This is one screen with four states
plus a modal. Do frame 1 (the ring with names in it, nothing fought yet) and check in with me
before the rest.

---

## Context

A browser idle RPG in the shape of Melvor Idle. Skills train on a timer, combat resolves
without input, sessions run for hours in a background tab. The setting is "the hill" — austere
and dry, plain material words, never high fantasy. Screens A–H are built; the tokens came from
them and are in `src/ui/theme/tokens.css`.

The ring is the game's first player-versus-player anything, and the first place where one
name's loss is another name's doing. It works like this:

- **Stepping in is opt in, both ways.** Barred by default. A name that has not stepped in is on
  nobody's list and can call nobody. This mirrors the open road (Screen E's road row) and the
  copy should rhyme with it.
- **You call a name out for one thing they are wearing.** You automatically put up whatever you
  wear in the same slot, and it must be worth at least as much — you can only play for a helm
  by wagering your helm.
- **The register fights it the moment you ask.** Both fighters are worked out from the two
  stored saves; neither player has to be online, and the loser finds out when they next play.
- **What changes hands moves on the loser's next save**, not instantly. The card has to say so
  without making it sound broken.
- A name may be called out once every 4 h by anyone, and may call once every 1 h.
- A debt that cannot be paid in kind costs twice the thing's worth in coin, and what still
  cannot be paid is **owed** — an owing name is out of the ring until it is square.

**Tone.** Nobody "challenges" anybody and there are no belts, ranks or taunts. A name _calls
another out_; a fight is a _bout_; the thing at stake is _what was played for_. Losing should
read as a plain fact, not a defeat screen. The dryness is the point: "Vesper takes your iron
helm. It goes on your next save."

**What it looks like today.** Screen E's fight card over Screen A's rows, with the pick modal
borrowed from the hall's give modal. It works and it is legible; it has no identity of its own.

## What's on the screen

### Header

`ScreenHead` with icon `sbed/duel`, title **The Ring**, a chip reading `stepped in` (gold) or
`barred`, and a rate line: `4 in the ring · 12 taken, 3 lost`.

### Main column, in order

**1. The step-in row.** A `card food-row` copied from Screen E's road row: label "The ring", a
tile with the duel icon (dimmed when out), a name line ("Stepped In" / "Out Of The Ring"), a
sub line, and a right-hand button ("Step in" / "Step out"). Out, the sub reads: _"Nobody may
call you out, and you may call nobody. The ring is opt in, both ways."_ In, it reads what you
are risking and what you have done: _"any name in the ring may call you out for something you
are wearing, and you them · 15 fought, 12 taken, 3 lost"_. If a balance is owed, that belongs
here too and should be impossible to miss.

**2. The bout card** (only after a bout, and dismissible). Screen E's `fight-sides`: two
`fight-side` columns, each with the name's likeness, an hp bar, a stats line, a swing bar. It
**replays** — the bout is re-run from the register's seed at the sim's own tick rate, so the
bars drain and damage numbers pop exactly as they did. Under it: who won, what they take, and
the line about the next save. This is the emotional centre of the screen and the one thing
worth real design attention. What should it feel like to watch a fight you have already lost?

**3. Who is in.** A `card list` of rows: likeness, name, `level 71 · 15 fought, 12 taken`,
last seen, and a right-hand **Call out** button — or a `rests 2 h 15 min` chip when that name
is inside their cooldown. When the reader cannot call at all (not stepped in, owed, own
cooldown), the card head says why in one line and the buttons go quiet.

### Side column

**The bout card list.** Every bout this name has been in, newest first: the other name's
likeness, "Took the Iron Helm" / "Lost the Iron Helm", who called whom, on points or not, and
how long ago. Won and lost rows need to be tellable apart without colour alone.

### The call-out modal

Opens on **Call out**. Head: "Call out Vesper". A line of their fighter's numbers. Then one row
per thing they are wearing: item tile, name, `head · worth 665 gp · you put up your Silver
Helm`, and a **Play for it** button — or, when it cannot be played for, the reason in place of
the button (_"your Iron Helm is not worth their Silver Helm"_, _"you have nothing in the body
slot to put up"_). Rows that can be played for come first, dearest first.

The modal is where someone decides to risk real gear. It currently gives that decision no more
weight than buying a bank slot. It probably deserves more.

## The states, each of which needs a look

1. **Barred** — the reader has not stepped in. Everything is behind one decision.
2. **In, ring empty** — stepped in, nobody else has. Must not read as broken.
3. **In, names listed** — the working state. Frame 1.
4. **Owing** — a balance is open, the ring is closed to them until it is paid.
5. **Just fought** — the bout card, mid-replay and settled.

## Constraints

- **Same system.** Tokens and components from the existing library; no new colours. Rarity and
  material colours are data and stay out of the chrome.
- **Numbers don't jitter.** Tabular mono for every figure. The replay ticks ten times a second;
  hp text must not reflow.
- **Never colour alone.** Won/lost, in/out, can/cannot must each carry a word or a mark.
- **~390px.** The two-column fight card is the hard part narrow. Stacked, side by side at 60%,
  or something else?
- **Juice has three levels** (`deadpan` / `quiet` / `juicy`). Deadpan must skip the replay and
  show the settled result immediately. Say what each level does here.

## Open questions

1. **The tab bar is already twelve tabs wide** and scrolls horizontally. A thirteenth is the
   real question this screen raises: does the ring earn a tab, live under the combat screen, or
   is it time for the nav to change shape? I would rather you told me the nav is wrong than
   squeezed one more in.
2. **How does a bout you lost while away reach you?** Right now it is a row in a feed you have
   to visit. Should losing gear interrupt — a toast, the offline recap, the level-up moment's
   treatment — or is quiet correct for a game you leave running?
3. **What does the replay do about a wipe?** Most bouts between mismatched names end in two or
   three swings. Is a two-second replay worth building, or does the card want a summary with
   the replay as an option?
4. **Should the odds be shown before you call?** The numbers are all there. Showing them makes
   the ring solvable and possibly dull; hiding them makes it a coin toss with your gear. Where
   should that land?

## What I want back

1. A populated desktop frame of state 3, with **specific fake data** — real-looking names,
   real item names off the ladder (Iron Helm, Silver Cuirass, Aether Sword), plausible levels
   and cooldowns. Not lorem, not eight rows of "Item".
2. States 1, 2, 4 and 5 side by side.
3. The bout card at three moments: mid-replay, just settled with a win, just settled with a loss.
4. The call-out modal, with at least one row that cannot be played for.
5. ~390px of frame 1 and of the bout card.
6. Your answers to the four questions.

Check in after 1 before doing the rest.
