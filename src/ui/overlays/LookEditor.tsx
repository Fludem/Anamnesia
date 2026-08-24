/**
 * The brush: sixteen cells by sixteen under the pointer, in the design's colours, with a few
 * plain shapes to lay under the paint. Paint, fill and rub out by hand; drag a disc, box,
 * triangle, diamond or line over the grid; tap a shape to pick it up, then turn, lower,
 * recolour, press or remove it. Mirror paints both halves at once, Fold over folds the left
 * half onto the right. The previews on the right are the honest mirror: the sizes the hill
 * actually shows a face at. Designed as "Likeness — Disc & Brush"; it is the game's one
 * creative surface, so it is laid out as a tool, not as another form.
 */
import { Fragment, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  bands,
  cellAt,
  emptyLook,
  flood,
  GRID,
  inside,
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
/** Tapping a shape picks it up instead of laying a new one, so the canvas is the shortest path. */
const TAP_HINT = 'tap a shape to pick it up';

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
/** The sizes the previews answer for: the ramp's top, middle and floor. */
const PREVIEW_SIZES = [52, 36, 22];

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

/** The topmost shape covering a cell's centre, or null. */
function shapeAt(shapes: Shape[], x: number, y: number): number | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (inside(shapes[i]!, x + 0.5, y + 0.5)) return i;
  return null;
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
  /** Fold the left half onto the right: symmetry after the fact, not only while painting. */
  const foldOver = () =>
    commit((l) => {
      let paint = l.paint;
      for (let y = 0; y < GRID; y++)
        for (let x = 0; x < GRID / 2; x++)
          paint = withCell(paint, GRID - 1 - x, y, cellAt(l.paint, x, y));
      return paint === l.paint ? l : { ...l, paint };
    });

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
    if (drag && isShapeTool) {
      // A tap that lands on a shape picks it up; a tap on bare ground lays a single cell.
      const tap = drag.x0 === drag.x1 && drag.y0 === drag.y1;
      const hit = tap ? shapeAt(look.shapes, drag.x0, drag.y0) : null;
      if (hit !== null) {
        setSelected(hit);
      } else if (look.shapes.length < MAX_SHAPES) {
        const shape: Shape = { k: tool, ...dragBox(drag), c: colour };
        commit((l) => ({ ...l, shapes: [...l.shapes, shape] }));
        setSelected(look.shapes.length);
      }
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
  const painted = /[^.]/.test(look.paint);
  const title = kind === 'hall' ? "The hall's mark" : 'Your likeness';
  const lead =
    kind === 'hall'
      ? 'Over the door, beside the names in it. Only the founder paints it.'
      : 'What the hill sees beside your name: at the fire, on the boards, in the hall.';
  const canvasPx = GRID * CELL_PX;
  const toolHint = TOOLS.find((t) => t.id === tool)?.hint ?? '';
  const canvasStyle = {
    width: canvasPx,
    height: canvasPx,
    '--cell': `${String(CELL_PX)}px`,
  } as CSSProperties;

  return (
    <Modal onClose={busy ? undefined : onClose} wide>
      <div className="look-editor">
        <div className="look-head">
          <span className="look-title">{title}</span>
          <span className="hint">
            {count === 0 ? 'nothing yet' : `${String(count)} ${count === 1 ? 'mark' : 'marks'}`}
            {look.shapes.length >= MAX_SHAPES ? ' · no room for another shape' : ''}
          </span>
        </div>
        <div className="lead">{lead}</div>

        <div className="look-body">
          <div className="look-left" style={{ width: canvasPx + 2 }}>
            <div className="look-tools">
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
              style={canvasStyle}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              role="img"
              aria-label={`${title}: ${String(GRID)} by ${String(GRID)} cells`}
            >
              {blank && (
                <span className="look-ghost" aria-hidden="true">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <LookArt look={look} className="look-layer" />
              {previewLook && <LookArt look={previewLook} className="look-layer preview" />}
              <span className="look-grid" />
              {picked && (
                <span
                  className="look-picked"
                  style={{
                    left: picked.x * CELL_PX - 1,
                    top: picked.y * CELL_PX - 1,
                    width: picked.w * CELL_PX + 2,
                    height: picked.h * CELL_PX + 2,
                  }}
                />
              )}
            </div>
            <div className="hint look-hint">
              {toolHint}
              {isShapeTool ? ` · ${TAP_HINT}` : ''}
            </div>
            <div className="look-actions">
              <button
                className={mirror ? 'btn sm on' : 'btn sm'}
                onClick={() => setMirror((m) => !m)}
                title="paints both halves at once"
              >
                Mirror
              </button>
              <button
                className="btn sm"
                onClick={foldOver}
                disabled={!painted}
                title="mirror what I have, left onto right"
              >
                Fold over
              </button>
              <span className="spacer" />
              <button className="btn sm" onClick={undo} disabled={history.length === 0}>
                Undo
              </button>
              <button className="btn sm undoing" onClick={clear} disabled={blank}>
                Clear
              </button>
            </div>
          </div>

          <div className="look-right">
            <div className="look-section">
              <div className="look-section-head">
                <Label>Colour</Label>
                <span className="look-colour-name">{PALETTE[colour]!.name}</span>
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
                  className={look.bg === null ? 'btn sm on' : 'btn sm'}
                  onClick={() => commit((l) => (l.bg === null ? l : { ...l, bg: null }))}
                  disabled={look.bg === null}
                  title="no backdrop: the disc shows through"
                >
                  None
                </button>
              </div>
              <div className="look-palette" role="radiogroup" aria-label="Colour">
                {bands().map((band) => (
                  <div className="look-band" key={band.name}>
                    <span className="look-band-name">{band.name}</span>
                    <div className="look-band-swatches">
                      {band.swatches.map(({ index, swatch }) => (
                        <button
                          key={swatch.hex}
                          className={index === colour ? 'look-swatch on' : 'look-swatch'}
                          style={{ background: swatch.hex }}
                          onClick={() => setColour(index)}
                          title={swatch.name}
                          role="radio"
                          aria-checked={index === colour}
                          aria-label={swatch.name}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="look-section">
              <div className="look-section-head">
                <Label>Shapes</Label>
                {look.shapes.length > 0 && (
                  <span className="hint">
                    {String(look.shapes.length)} of {String(MAX_SHAPES)} · bottom to top
                  </span>
                )}
              </div>
              <div className="look-stack">
                {look.shapes.length === 0 ? (
                  <div className="look-stack-empty">none yet · pick a shape tool and drag</div>
                ) : (
                  look.shapes.map((s, i) => (
                    <Fragment key={i}>
                      <button
                        className={i === selected ? 'look-shape on' : 'look-shape'}
                        onClick={() => setSelected(i === selected ? null : i)}
                        title={`${SHAPE_WORD[s.k]} · ${PALETTE[s.c]!.name}`}
                      >
                        <span
                          className="look-swatch tiny"
                          style={{ background: PALETTE[s.c]!.hex }}
                        />
                        {SHAPE_WORD[s.k]}
                        <span className="look-shape-pos">
                          {i === 0 ? 'bottom' : i === look.shapes.length - 1 ? 'top' : ''}
                        </span>
                      </button>
                      {i === selected && (
                        <div className="look-shape-actions">
                          {(s.k === 'tri' || s.k === 'line') && (
                            <button
                              className="btn sm"
                              onClick={() => changeShape((sh) => ({ ...sh, r: (sh.r + 1) % 4 }))}
                              title="a quarter turn"
                            >
                              Turn
                            </button>
                          )}
                          <button
                            className="btn sm"
                            onClick={() => moveShape(-1)}
                            disabled={i === 0}
                            title="one step further under"
                          >
                            Lower
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => moveShape(1)}
                            disabled={i === look.shapes.length - 1}
                            title="one step nearer the top"
                          >
                            Raise
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => changeShape((sh) => ({ ...sh, c: colour }))}
                            disabled={s.c === colour}
                            title={`give it ${PALETTE[colour]!.name}`}
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
                          <button
                            className="btn sm undoing"
                            onClick={removeShape}
                            title="take it off the stack"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </Fragment>
                  ))
                )}
              </div>
            </div>

            <div className="look-section">
              <Label>As the hill sees it</Label>
              <div className="look-previews">
                {PREVIEW_SIZES.map((px) => (
                  <span key={px} className="look-preview">
                    <FaceOf look={blank ? null : look} name={name} kind={kind} size={px} />
                    <span className="size">{px}px</span>
                  </span>
                ))}
                <span className="look-previews-note">
                  what reads at {String(canvasPx)} often dies at {String(PREVIEW_SIZES.at(-1))}
                </span>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="note-line warn" role="alert">
            {error}
          </div>
        )}
        <div className="foot look-foot">
          <span className="look-foot-note">
            {busy ? 'the register is taking it down' : 'nothing is kept until you keep it'}
          </span>
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
