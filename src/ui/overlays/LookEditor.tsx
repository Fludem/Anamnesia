/**
 * Painting a look: sixteen cells by sixteen under the pointer, in the design's colours, with
 * a few plain shapes to lay under the paint. Paint, fill and rub out by hand; drag a disc,
 * box, triangle, diamond or line over the grid; turn, lower, recolour, press or remove the
 * shape picked; mirror the paint down the middle; undo. The previews on the right are the
 * sizes the hill shows a face at. No design screen exists for this; it is the modal's card
 * with the bank's chips and buttons.
 */
import { useRef, useState, type PointerEvent } from 'react';
import {
  emptyLook,
  flood,
  GRID,
  isBlank,
  marks,
  MAX_SHAPES,
  PALETTE,
  stamp,
  withCell,
  type Look,
  type Shape,
  type ShapeKind,
} from '../../look/look.ts';
import { FaceOf, LookArt } from '../Face.tsx';
import type { LookKind } from '../looks.ts';
import { Label } from '../parts.tsx';
import { Modal } from './Modal.tsx';

type Tool = 'paint' | 'fill' | 'erase' | ShapeKind;

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'paint', label: 'Paint', hint: 'one cell at a time; drag to keep going' },
  { id: 'fill', label: 'Fill', hint: 'every joined cell of the same colour' },
  { id: 'erase', label: 'Erase', hint: 'back to bare' },
  { id: 'disc', label: 'Disc', hint: 'drag a box; the disc fills it' },
  { id: 'box', label: 'Box', hint: 'drag a box' },
  { id: 'tri', label: 'Tri', hint: 'drag a box; Turn points it' },
  { id: 'diamond', label: 'Diamond', hint: 'drag a box; the diamond fills it' },
  { id: 'line', label: 'Line', hint: 'drag corner to corner; Turn takes the other diagonal' },
];

const SHAPE_WORD: Record<ShapeKind, string> = {
  disc: 'disc',
  box: 'box',
  tri: 'triangle',
  diamond: 'diamond',
  line: 'line',
};

const UNDO_DEPTH = 40;
/** The first colour offered: the design's text. */
const FIRST_COLOUR = 7;
/** Cells the canvas shows per side, px. */
const CELL_PX = 18;

export interface LookEditorProps {
  kind: LookKind;
  /** Whose: the name or the hall. */
  name: string;
  initial: Look | null;
  /** Keep it (null takes it down); resolves to the register's refusal, or null. */
  onSave: (look: Look | null) => Promise<string | null>;
  onClose: () => void;
}

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The box a drag from one cell to another covers. */
function dragBox(d: Drag): { x: number; y: number; w: number; h: number; r: number } {
  const x = Math.min(d.x0, d.x1);
  const y = Math.min(d.y0, d.y1);
  return {
    x,
    y,
    w: Math.abs(d.x1 - d.x0) + 1,
    h: Math.abs(d.y1 - d.y0) + 1,
    // A line dragged up and across takes the other diagonal.
    r: (d.x1 - d.x0) * (d.y1 - d.y0) < 0 ? 1 : 0,
  };
}

export function LookEditor({ kind, name, initial, onSave, onClose }: LookEditorProps) {
  const [look, setLook] = useState<Look>(() => initial ?? emptyLook());
  const [history, setHistory] = useState<Look[]>([]);
  const [tool, setTool] = useState<Tool>('paint');
  const [colour, setColour] = useState(FIRST_COLOUR);
  const [mirror, setMirror] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The look as it was when the stroke began; one undo step per stroke. */
  const strokeFrom = useRef<Look | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = (before: Look) => setHistory((h) => [...h.slice(-(UNDO_DEPTH - 1)), before]);
  /** A change worth undoing: remember where we were, then apply. */
  const commit = (next: (look: Look) => Look) => {
    const out = next(look);
    if (out === look) return;
    remember(look);
    setLook(out);
  };
  /** A change within one stroke: no new undo step (the stroke's end remembers its start). */
  const amend = (next: (look: Look) => Look) => setLook((cur) => next(cur));

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setLook(last);
    setSelected(null);
  };
  const clear = () => {
    commit(() => emptyLook());
    setSelected(null);
  };

  // ---- the canvas -----------------------------------------------------------------------

  const cellOf = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID);
    return [Math.max(0, Math.min(GRID - 1, x)), Math.max(0, Math.min(GRID - 1, y))];
  };

  const paintCell = (x: number, y: number) => {
    const c = tool === 'erase' ? null : colour;
    amend((l) => {
      let paint = tool === 'fill' ? flood(l.paint, x, y, c) : withCell(l.paint, x, y, c);
      if (mirror && tool !== 'fill') paint = withCell(paint, GRID - 1 - x, y, c);
      else if (mirror) paint = flood(paint, GRID - 1 - x, y, c);
      return paint === l.paint ? l : { ...l, paint };
    });
  };

  const isShapeTool = tool !== 'paint' && tool !== 'fill' && tool !== 'erase';

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = cellOf(e);
    if (isShapeTool) {
      setDrag({ x0: x, y0: y, x1: x, y1: y });
    } else {
      strokeFrom.current = look;
      paintCell(x, y);
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      const [x, y] = cellOf(e);
      if (x !== drag.x1 || y !== drag.y1) setDrag({ ...drag, x1: x, y1: y });
    } else if (strokeFrom.current !== null && tool !== 'fill') {
      const [x, y] = cellOf(e);
      paintCell(x, y);
    }
  };
  const onUp = () => {
    const before = strokeFrom.current;
    strokeFrom.current = null;
    if (before !== null && before !== look) remember(before);
    if (drag && isShapeTool && look.shapes.length < MAX_SHAPES) {
      const shape: Shape = { k: tool, ...dragBox(drag), c: colour };
      commit((l) => ({ ...l, shapes: [...l.shapes, shape] }));
      setSelected(look.shapes.length);
    }
    setDrag(null);
  };

  const previewLook: Look | null =
    drag && isShapeTool
      ? {
          v: 1,
          bg: null,
          shapes: [{ k: tool, ...dragBox(drag), c: colour }],
          paint: emptyLook().paint,
        }
      : null;

  // ---- the shape picked ---------------------------------------------------------------------

  const picked = selected === null ? null : (look.shapes[selected] ?? null);
  const changeShape = (next: (s: Shape) => Shape) => {
    if (selected === null) return;
    commit((l) => ({
      ...l,
      shapes: l.shapes.map((s, i) => (i === selected ? next(s) : s)),
    }));
  };
  const moveShape = (by: -1 | 1) => {
    if (selected === null) return;
    const to = selected + by;
    if (to < 0 || to >= look.shapes.length) return;
    commit((l) => {
      const shapes = [...l.shapes];
      const [s] = shapes.splice(selected, 1);
      shapes.splice(to, 0, s!);
      return { ...l, shapes };
    });
    setSelected(to);
  };
  const removeShape = () => {
    if (selected === null) return;
    commit((l) => ({ ...l, shapes: l.shapes.filter((_, i) => i !== selected) }));
    setSelected(null);
  };
  const stampShape = () => {
    if (picked === null) return;
    commit((l) => ({
      ...l,
      paint: stamp(l.paint, picked),
      shapes: l.shapes.filter((_, i) => i !== selected),
    }));
    setSelected(null);
  };

  // ---- keeping it -----------------------------------------------------------------------------

  const save = async (what: Look | null) => {
    setBusy(true);
    setError(null);
    const failed = await onSave(what);
    setBusy(false);
    if (failed !== null) setError(failed);
  };

  const blank = isBlank(look);
  const count = marks(look);
  const title = kind === 'hall' ? "The hall's mark" : 'Your likeness';
  const lead =
    kind === 'hall'
      ? 'Over the door, beside the names in it. Only the founder paints it.'
      : 'What the hill sees beside your name: at the fire, on the boards, in the hall.';
  const canvasPx = GRID * CELL_PX;
  const toolHint = TOOLS.find((t) => t.id === tool)?.hint ?? '';

  return (
    <Modal onClose={busy ? undefined : onClose} wide>
      <div className="look-editor">
        <div className="look-head">
          <Label>{title}</Label>
          <span className="spacer" />
          <span className="hint">
            {count === 0 ? 'nothing yet' : `${String(count)} ${count === 1 ? 'mark' : 'marks'}`}
            {look.shapes.length >= MAX_SHAPES ? ' · no room for another shape' : ''}
          </span>
        </div>
        <div className="lead">{lead}</div>

        <div className="look-body">
          <div className="look-left" style={{ width: canvasPx + 2 }}>
            <div className="chips look-tools">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  className={tool === t.id ? 'btn sm on' : 'btn sm'}
                  onClick={() => setTool(t.id)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              className={`look-canvas${mirror ? ' mirrored' : ''}`}
              style={{
                width: canvasPx,
                height: canvasPx,
                backgroundSize: `${String(CELL_PX)}px ${String(CELL_PX)}px`,
              }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              role="img"
              aria-label={`${title}: ${String(GRID)} by ${String(GRID)} cells`}
            >
              <LookArt look={look} className="look-layer" />
              {previewLook && <LookArt look={previewLook} className="look-layer preview" />}
              {picked && (
                <span
                  className="look-picked"
                  style={{
                    left: picked.x * CELL_PX,
                    top: picked.y * CELL_PX,
                    width: picked.w * CELL_PX,
                    height: picked.h * CELL_PX,
                  }}
                />
              )}
            </div>
            <div className="hint look-hint">{toolHint}</div>
            <div className="chips look-actions">
              <button
                className={mirror ? 'btn sm on' : 'btn sm'}
                onClick={() => setMirror((m) => !m)}
                title="paint both halves at once"
              >
                Mirror
              </button>
              <button className="btn sm" onClick={undo} disabled={history.length === 0}>
                Undo
              </button>
              <button className="btn sm" onClick={clear} disabled={blank}>
                Clear
              </button>
            </div>
          </div>

          <div className="look-right">
            <Label>Colour</Label>
            <div className="look-palette" role="radiogroup" aria-label="Colour">
              {PALETTE.map((sw, i) => (
                <button
                  key={sw.hex}
                  className={i === colour ? 'look-swatch on' : 'look-swatch'}
                  style={{ background: sw.hex }}
                  onClick={() => setColour(i)}
                  title={sw.name}
                  role="radio"
                  aria-checked={i === colour}
                  aria-label={sw.name}
                />
              ))}
            </div>
            <div className="look-colour-line">
              <span className="look-swatch tiny" style={{ background: PALETTE[colour]!.hex }} />
              <span className="hint">{PALETTE[colour]!.name}</span>
              <span className="spacer" />
              <button
                className="btn sm"
                onClick={() => commit((l) => (l.bg === colour ? l : { ...l, bg: colour }))}
                disabled={look.bg === colour}
                title="fill the whole face with this, under everything"
              >
                Backdrop
              </button>
              <button
                className="btn sm"
                onClick={() => commit((l) => (l.bg === null ? l : { ...l, bg: null }))}
                disabled={look.bg === null}
                title="no backdrop: the disc shows through"
              >
                None
              </button>
            </div>

            <Label>Shapes</Label>
            {look.shapes.length === 0 ? (
              <div className="hint look-hint">none yet · pick a shape tool and drag</div>
            ) : (
              <div className="look-shapes">
                {look.shapes.map((s, i) => (
                  <button
                    key={i}
                    className={i === selected ? 'look-shape on' : 'look-shape'}
                    onClick={() => setSelected(i === selected ? null : i)}
                    title={`${SHAPE_WORD[s.k]} · ${PALETTE[s.c]!.name}`}
                  >
                    <span className="look-swatch tiny" style={{ background: PALETTE[s.c]!.hex }} />
                    {SHAPE_WORD[s.k]}
                  </button>
                ))}
              </div>
            )}
            {picked && (
              <div className="chips look-actions">
                <button
                  className="btn sm"
                  onClick={() => changeShape((s) => ({ ...s, r: (s.r + 1) % 4 }))}
                  disabled={picked.k !== 'tri' && picked.k !== 'line'}
                  title="a quarter turn"
                >
                  Turn
                </button>
                <button
                  className="btn sm"
                  onClick={() => moveShape(-1)}
                  disabled={selected === 0}
                  title="one step further under"
                >
                  Lower
                </button>
                <button
                  className="btn sm"
                  onClick={() => moveShape(1)}
                  disabled={selected === look.shapes.length - 1}
                  title="one step nearer the top"
                >
                  Raise
                </button>
                <button
                  className="btn sm"
                  onClick={() => changeShape((s) => ({ ...s, c: colour }))}
                  disabled={picked.c === colour}
                  title="give it the colour picked"
                >
                  Recolour
                </button>
                <button
                  className="btn sm"
                  onClick={stampShape}
                  title="press it into the paint, cell by cell"
                >
                  Press
                </button>
                <button className="btn sm" onClick={removeShape}>
                  Remove
                </button>
              </div>
            )}

            <Label>As the hill sees it</Label>
            <div className="look-previews">
              {[52, 36, 22].map((px) => (
                <span key={px} className="look-preview">
                  <FaceOf look={blank ? null : look} name={name} kind={kind} size={px} />
                  <span className="name">{name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="note-line warn" role="alert">
            {error}
          </div>
        )}
        <div className="foot">
          <button className="btn quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {initial !== null && (
            <button
              className="btn quiet"
              onClick={() => void save(null)}
              disabled={busy}
              title="back to the first letter"
            >
              Take it down
            </button>
          )}
          <button
            className="btn primary"
            style={{ flex: 1 }}
            onClick={() => void save(blank ? null : look)}
            disabled={busy || (blank && initial === null)}
          >
            {busy ? 'One moment' : 'Keep it'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
