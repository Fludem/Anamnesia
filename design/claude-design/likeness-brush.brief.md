# Claude Design brief — the Brush: likeness & mark editor

Same project, same library. Not a screen — a wide modal that opens over any screen, plus the
small disc component the whole game shows the result in. Design the disc first, then the
brush; check in after the first frame.

---

## Context

Since Phase 15 every name can paint a **likeness** — a 16×16-cell picture shown beside their
name everywhere on the hill: at the fire, in word threads, on the highscore boards, in the
hall's names, at the wheel's table. Every hall gets a **mark**, painted by its founder,
shown over the door and on the halls list. A name that never paints one shows its first
letter in a plain disc.

The editor works and people use it, but it was built with no mock — it is the modal's card
with the bank's chips and buttons. It is also the game's one *creative* surface: everything
else on the hill is reading and pressing buttons; this is the only place a player makes
something. It deserves to feel like a small, serious tool — a brush, not a toy.

Tone as ever: austere, dry, material words. The UI never says "avatar" — a name has a
**likeness**, a hall a **mark**. The palette swatches have names like Ink, Soot, Moss,
Verdigris, Honey, Rust, Basalt, Aether.

## The model (fixed — design around it)

A look is three layers, bottom to top:

1. **Backdrop** — one flat colour, or none (the bare disc shows through).
2. **Shapes** — up to 24 stacked vector shapes: disc, box, triangle, diamond, line. Each
   has a colour and a box of cells; triangles and lines turn in quarter turns. Shapes stay
   vector, so a look is crisp at any size.
3. **Paint** — the 16×16 cell grid, painted by hand over everything.

The palette is **36 fixed colours drawn from the design itself** — the chrome's greys, the
accent greens, the golds, the hurt reds, and the material-tier colours (basalt blues, aether
purples...). It is append-only data: a stored look is a list of indices into it. You may
group and present the swatches however reads best; you may not invent colours or reorder
the stored indices.

## The disc (the component everyone sees)

A painted look, or the first letter, in a disc. A name's is round; a hall's mark sits in a
square (rounded). Sizes in the wild today: 52 / 36 / 28 / 22 / 18 / 11 px, plus wherever
`.avatar` is placed unsized. Design the ramp once — frame, letter fallback type, painted
fill (the picture bleeds to the edge), and how round vs square distinguishes a name from a
hall at a glance.

## The editor

A wide modal. Title **Your likeness** / **The hall's mark**, with a lead line that ships:

- likeness: _What the hill sees beside your name: at the fire, on the boards, in the hall._
- mark: _Over the door, beside the names in it. Only the founder paints it._

Header hint: `nothing yet` / `14 marks`, and when the shape stack is full,
`· no room for another shape`.

Reached from: the sidebar name menu → **Likeness**, Settings → Likeness, and the hall
door's **Paint the mark** (founder only).

### Left: the canvas

- The 16×16 grid, cells 18px (288px square), faint gridlines over the empty ground.
- Tool row above it (chips, one active): **Paint · Fill · Erase · Disc · Box · Tri ·
  Diamond · Line.** Each has a one-line hint that shows under the canvas for the active
  tool (shipped copy: `one cell at a time; drag to keep going` / `every joined cell of the
  same colour` / `back to bare` / `drag a box; the disc fills it` / `drag a box` / `drag a
  box; Turn points it` / `drag a box; the diamond fills it` / `drag corner to corner; Turn
  takes the other diagonal`).
- Shape tools drag out a live preview; releasing adds the shape and selects it. The
  selected shape shows a selection box on the canvas.
- Under the canvas: **Mirror** (a toggle — paints both halves at once; the canvas shows
  it's on), **Undo** (40 deep, one step per stroke, not per cell), **Clear**.

### Right: colour, shapes, previews

- **Colour** — the 36 swatches, current one ringed, its name shown (`Verdigris`). Beside
  it: **Backdrop** (fill the ground with this colour, under everything) and **None** (the
  disc shows through).
- **Shapes** — the stack as a list, bottom to top: a small swatch + the word (`disc`,
  `triangle`...). Empty state: `none yet · pick a shape tool and drag`. Selecting one opens
  its actions: **Turn** (tri/line only, a quarter turn) · **Lower** / **Raise** (one step in
  the stack) · **Recolour** (to the colour picked) · **Press** (stamp it into the paint,
  cell by cell — it stops being a shape) · **Remove**.
- **As the hill sees it** — live previews at 52 / 36 / 22 px with the name beneath. This is
  the honest mirror: what reads at 288px often dies at 22. Give it weight.

### Footer

Cancel · **Take it down** (only when a look already exists; tooltip `back to the first
letter`) · **Keep it** (primary; keeping a blank canvas takes it down). A register refusal
shows as one warn line. While saving, buttons say `One moment` and the modal won't close.

## Constraints

- **Same system.** Modal chrome, chips, buttons from the library. The canvas ground is not
  the card background — bare cells must read as *empty*, in both the painted-backdrop and
  no-backdrop cases.
- **Pointer means mouse and touch.** Strokes are drags; there is no hover on a phone, so
  tool hints can't live in tooltips alone.
- **~390px.** The two columns must stack and the canvas must still be strokeable — 288px
  fits, but the palette, shape list and previews have to find their places around it. Show
  me the reflow.
- Nothing animates. The drag preview and the selection box are the only transient marks.

## Open questions

1. **The palette wall.** 36 swatches in a grid is a lot of same-sized dots. Group by family
   (greys / greens / golds / reds / blues / purples)? Names on hover only, or does the
   current colour's name line suffice?
2. **The shape stack.** A word-list with six action buttons is the flattest part of the
   build. Is there a lighter layers treatment — and should selecting a shape on the canvas
   itself (tap it) be the primary path, with the list secondary?
3. **Mirror.** Today it's a mode you switch on before painting. Would an action — "mirror
   what I have, left onto right" — serve better, or both?
4. **First-open.** A blank grid and eight tools is a cold start. Without adding content
   (no preset gallery exists server-side), is there a design answer — a ghosted hint, the
   letter shown faintly as a guide, a suggested first stroke?

## What I want back

1. **The disc ramp** — painted and letter-fallback, name-round and hall-square, at 52 / 36 /
   28 / 22 / 18 / 11, on the row backgrounds they actually sit on (chat row, board row,
   hall header).
2. The editor mid-work, desktop: a likeness with a backdrop, three shapes (one selected,
   actions open), paint over the top, Mirror on, `14 marks` in the header.
3. The same for a hall's mark (founder copy, square previews).
4. First-open (blank) and the saving/refused states.
5. ~390px.
6. Answers to the four questions.

Check in after 1 and 2 before doing the rest.
