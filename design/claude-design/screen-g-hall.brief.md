# Claude Design brief — Screen G: the Hall

Same project, same library, same shell as Screens A–F. This is one screen with two states —
outside a hall and inside one — plus one modal. Design it, check in after the first frame,
and we'll hand it back to code.

---

## Context

The hall is the clan. It has been live since Phase 12 and was built with no mock — it is
Screen A's rows and Screen E's two columns, same as the Trader was. It works; it does not
look designed.

What the hall is for: it is the game's shared project. A hall has six **rooms**, each raised
through three tiers by what its names give — logs, ore, fish, bone, coins, whatever the tier
asks for. A raised room gives every name in the hall a small standing perk (a few percent).
Tier I is an evening of one name's work (~3–5 h), tier II a couple of days (~17–26 h),
tier III a week or more (~59–91 h) — which is the point: a hall shares the work. Giving is
the social act; the rooms are the monument to it.

The player is in one of two states and never both:

- **No hall** — a door. Found a hall, ask at one, answer invites waiting, see the other
  halls on the hill.
- **In a hall** — the rooms, the names, the door (invites and petitions), the ledger.

Tone: the hill is austere and dry. A hall is not a guild with banners and fanfare; it is a
building that gets raised one cartload at a time. Every room has one line of copy, already
written; keep the lines.

## The marks and likenesses

Since Phase 15 every name can paint a **likeness** (a small hand-painted SVG face) and every
hall a **mark** (same, painted by the founder — "the mark over the door, beside every name
in the hall"). The component is a disc: the painting if one exists, else the first letter of
the name. Marks and likenesses appear throughout this screen:

- the hall's mark in the header beside its name (28px), and on every row of the halls list
- each member's likeness in the Names card
- the founder reaches the brush from a **Paint the mark** button on the door card

Design the disc's frame once (size ramp, unpainted letter fallback) — it's already shipping
in chat, highscores and the wheel, so it should feel like the same object here.

## What's on the screen

### State 1 — no hall: the door

Header: castle icon (`delapouite/castle`, the nav icon), **Hall**, chip `no hall yet`.
No XP row; the hall is not a skill.

**Main column, in order:**

1. **Waiting for you** — invites, only when there are any. Hint: `someone held a door open`.
   Row: the hall's name (with its mark), sub `Alpha holds the door · 3 h ago`, buttons
   Decline / **Accept**.
2. **Where you asked** — the player's open petitions, only when there are any. Hint:
   `the founder decides`. Row: hall name, sub `you asked at the door · just now`, one
   button: Withdraw.
3. **Found a hall** — a form. Hint: _A hall may be one name. The rooms are raised with what
   its names give._ Text input (placeholder `e.g. The Quiet Hall`, max 24) + **Found it**.
4. **Ask at a door** — a form. Hint: _The founder decides. An invite already waiting lets
   you straight in._ Input (`The hall's name`) + **Ask**.
5. A quiet footer when the player left a hall with gifts still in flight:
   `still on the cart, coming back: 200 Oak Logs for The Hearth`.

**Side column: The halls** — every hall on the hill. Hint: `7 on the hill` (or `one on the
hill`). Row: mark disc, name, sub `4 names · 6 raised` (or `nothing raised yet`). Empty
state: `nobody has founded one yet`. This card is flagged in the build as "a card, not a
board" — see open question 1.

### State 2 — in a hall

Header: the hall's **mark** (28px), the hall's name as the title, chip
`4 names · 7 raised` (raised = tiers summed across rooms, 0–18), and in the rate slot
`gave 86,000 gp` — what this name has given, ever, valued in coins.

**Main column: Rooms.** One card, six rows, content order. Hint: `raised with what its
names give`. Each row:

- Tile with the room's icon — dimmed while the room is unraised.
- Name + tier tag when raised: a Roman numeral (`I` `II` `III`) in the active-tag style.
  Halls carve numerals; no "level 2".
- The room's line (copy below).
- A state sub: `not yet raised · next +1% xp in every skill` /
  `stands at II · next +3% xp in every skill` / `stands at III · finished`.
- **A progress bar** toward the next tier — overall fraction of everything the tier needs.
  This is the screen's one progress bar and it is *shared*: every name's gifts fill it. The
  brief's rule that progress bars are the core motif and deserve real design applies here
  hardest of all — this is the only bar in the game that other people move.
- The needs, one term per thing: `1,240/4,000 Willow Logs` unmet, `2,000 Ash` once met
  (met terms read as settled, not as still owed). A tier needs 5–7 things across ≥4 skills,
  plus coins from tier II up (`480,000/2,000,000 gp`).
- A **Give** button — enabled only when this name holds something the tier still needs;
  disabled tooltip: `you hold nothing it still needs`. At tier III the row is finished: no
  bar, no needs, no button. A record, not an ask.

Card footer when gifts are in flight: `on the cart, not yet taken: 1,500 Pine Logs for The
Hearth · 200,000 gp for The Strongroom`.

**Side column, in order:**

1. **The hall gives you** — the standing perks, one line each (exact copy below). Empty
   state: _Nothing yet. Raise a room._
2. **Names** — hint `founded by Alpha`. Row: likeness disc, name (+ `Founder` tag), sub:
   god icon + god name · `on the hill now` (accent) or `seen 3 h ago` · `gave 12,400 gp`.
   The player's own row is marked. The founder sees a quiet **Turn out** button on every
   other row.
3. **The door** — hint `you keep it` (founder) or `Alpha keeps it`. The founder — only the
   founder — sees the names asking (row: name, `asks at the door · 20 min ago`, Decline /
   **Accept**). Every member sees the **Invite a name** form (hint: _Anyone here may hold
   the door. A name already asking comes straight in._); the founder also gets **Paint the
   mark**. Last, **Leave the hall** — a quiet button that turns into `Really leave?` +
   `Stay` (inline two-step, no modal). A leaving founder hands the keys to whoever has been
   there longest; the door card doesn't say so today — a hint line is yours if you want it.
4. **The ledger** — hint `what the hall took`. Rows, newest first:
   `**Beta** gave 1,500 Pine Logs to The Hearth · 2 h ago`. Empty: `nothing yet`.

A small failure state exists for both states: the register unreachable — a single warn note
(`reading the register…` / `the hall could not be re-read: …`) in place of or above the
cards. One quiet treatment, not a broken page.

### The Give modal

Opens from a room's Give. Title `Give to The Hearth`. Flavour: `Toward II: +2% xp in every
skill.` Then:

- Chips of what this name holds that the tier still needs (`gp` is a chip like any item).
- Picked, a hint: `3,200 Pine Logs held · the room still needs 2,760`.
- Amount input + chips `10` `100` `1000` `ALL`, and a worth line: `worth 4,800 gp`.
- Cancel / **Give**.

The give moment: no confirmation, the gift leaves the bank at once and a gold `−1,500 Pine
Logs` pops over the screen (Screen A's number pop). Mechanically the gift rides out on a
cart with the next save (~15 s) and the bar moves when the register answers — in practice
the bar can lag the pop by a breath. Design for that honestly if you can (see question 3).

## The rooms (content that ships)

| Room           | Icon                    | Line                                                   | Perk at I / II / III                                    | Coins II / III |
| -------------- | ----------------------- | ------------------------------------------------------ | ------------------------------------------------------- | -------------- |
| The Hearth     | `delapouite/fireplace`  | Warm. Everyone sits a little closer to the work.       | +1% / +2% / +3% xp in every skill                       | 200k / 2M      |
| The Storehouse | `delapouite/warehouse`  | Things keep. Some of them come back doubled.           | gathering lands twice 3% / 6% / 9% of the time          | 150k / 2.5M    |
| The Larder     | `delapouite/granary`    | Salt, smoke and shelves. Nothing goes off.             | food heals 10% / 20% / 30% more                         | 150k / 2M      |
| The Strongroom | `delapouite/strongbox`  | Thick walls. A thicker door.                           | +5 / +10 / +15 bank slots                               | 300k / 3M      |
| The Watchtower | `delapouite/watchtower` | Someone is always up. The night lasts longer for it.   | the night lasts 2 h / 4 h / 6 h longer                  | 200k / 2.5M    |
| The Pyre       | `delapouite/pyre`       | He still comes. He charges less for friends of the house. | the ferryman takes 10% / 20% / 30% less              | 250k / 3M      |

Perk lines above are the exact shipped copy (from `perkLine`). Tier I costs no coins.
Example of a full need list, Hearth II: 4,000 Willow Logs · 3,000 Birch Logs · 2,000 Ash ·
1,000 Basalt Core · 800 Wolf Pelt · 600 Beeswax · 200,000 gp.

## Constraints

- **Same system.** Tokens and components from the library. The accent is for Give, Accept,
  raised-tier tags and "on the hill now"; gold (`--gold`) is for coins, the give-pop and
  the `Really leave?` step; `--hurt` doesn't belong here. Material tier colours stay out —
  needs are named in text, not drawn as item tiles (a row of six recoloured item icons per
  tier turns the card to soup; if you disagree, show me).
- **Numbers don't jitter.** Needs, fractions and gp are tabular mono; `held` counts tick
  live while a skill runs in the background.
- **Roman numerals** for tiers, everywhere.
- **Icons are monochrome game-icons SVGs** recoloured at runtime, standard tile box. The
  ids above ship; if a room wants a different glyph, say which.
- **~390px.** The side column stacks under the rooms; petitions and forms must survive a
  narrow card. Room rows are the hard case — bar + up to 7 needs + Give. Show me the reflow.
- Dark, calm, no illustration. Nothing animates but the give pop and the bar filling.

## Open questions

1. **The halls list.** Today it is a side card with name + two numbers. Should it be a real
   board — marks, names, raised, maybe founded-by — and if so does it stay on the door
   state only, or does a member get to see the other halls somewhere too? The data today is
   exactly: name, member count, tiers raised, mark.
2. **The wall of needs.** Six rooms × up to 7 terms each is a lot of numbers at rest.
   Collapse met needs? Show the two nearest-done and fold the rest? The bar carries the
   summary; decide how much ledger a row shows before you have to lean in.
3. **Whose bar is it.** The bar is hall-wide but anonymous; credit lives only in the ledger
   and the `gave N gp` numbers. Does the room row want any trace of *who* — likeness discs
   on recent gifts, a "mostly Beta" hint? Data today supports the ledger only (last 30
   gifts, hall-wide); say if the design wants more and I'll weigh the server work.
4. **Turn out has no confirm.** Leave is a two-step; expelling a name is one click. Give
   the founder's Turn out whatever treatment Leave gets, or argue it should stay cheap.

## What I want back

1. **Inside**, desktop width, populated mid-game: "The Quiet Hall", mark painted, 4 names
   (founder Alpha seen `just now`, Beta `on the hill now`, the player, and one name
   `seen 6 d ago`), chip `4 names · 7 raised`. Rooms: Hearth at II raising III (about a
   third in, coins part-paid), Watchtower at I raising II with Give enabled, Storehouse at
   I raising II with Give disabled, Larder unraised with a little progress, Strongroom
   unraised untouched, Pyre at III finished. Two gifts on the cart, four ledger lines, all
   six perk lines showing.
2. **The door**, desktop: one invite waiting, one open ask, four halls on the list (one
   with nothing raised), something coming back on the cart.
3. The room row states side by side: unraised untouched · raising and can give · raising,
   nothing to give · the moment a tier lands (the tag appearing) · finished at III.
4. The Give modal, and the give moment (before / pop / after).
5. Both states at ~390px.
6. Your answers to the four questions.

Check in after 1 before doing the rest.
