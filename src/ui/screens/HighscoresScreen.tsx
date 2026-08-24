/**
 * Highscores: every name on the hill, ranked from their last saves. Left, the hero's own
 * standing on every board (rank, level, xp) — pick one. Right, that board, best first, the
 * hero's row lit. The register ranks (server/register.ts); this screen only reads, so a row
 * can be up to a save behind the game — about ten seconds.
 */
import { content, simContext } from '../../content/index.ts';
import type { StandingRow } from '../../api/protocol.ts';
import { boardIds, type BoardId } from '../../sim/highscores.ts';
import { RING_ICON } from './RingScreen.tsx';
import { godOf } from '../../sim/perks.ts';
import type { SimState } from '../../sim/save.ts';
import { Face } from '../Face.tsx';
import { formatAge, formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import { useBoard } from '../useBoard.ts';
import { ScreenHead } from './common.tsx';

export const HIGHSCORES_ICON = 'lorc/laurel-crown';
const TOTAL_ICON = 'delapouite/stairs-goal';
const WEALTH_ICON = 'delapouite/gold-stack';

/** Saved within this long counts as here now. */
const HERE_NOW_MS = 90_000;

interface BoardMeta {
  name: string;
  icon: string;
  /** What the score column holds. */
  unit: string;
  hint: string;
}

function boardMeta(id: BoardId): BoardMeta {
  if (id === 'total') {
    return {
      name: 'Total level',
      icon: TOTAL_ICON,
      unit: 'xp',
      hint: 'every skill added up · total xp breaks ties',
    };
  }
  if (id === 'wealth') {
    return {
      name: 'Wealth',
      icon: WEALTH_ICON,
      unit: 'gp',
      hint: 'coins, the bank at sale value, everything worn',
    };
  }
  if (id === 'ring') {
    return {
      name: 'The ring',
      icon: RING_ICON,
      unit: 'taken',
      hint: 'things taken in the ring · bouts fought breaks ties',
    };
  }
  const skill = content.skill(id);
  return { name: skill.name, icon: skill.icon, unit: 'xp', hint: `xp in ${skill.name}` };
}

function seenLine(ms: number): string {
  return ms < HERE_NOW_MS ? 'on the hill now' : `last seen ${formatAge(ms)} ago`;
}

export interface HighscoresScreenProps {
  sim: SimState;
  /** Which board is open; an id the content no longer has falls back to total level. */
  board: BoardId;
  onBoard: (id: BoardId) => void;
  /** When this tab last saved: the board is re-read after each. */
  savedAtMs: number | null;
}

export function HighscoresScreen({
  sim,
  board: wanted,
  onBoard,
  savedAtMs,
}: HighscoresScreenProps) {
  const ids = boardIds(content);
  const open = ids.includes(wanted) ? wanted : 'total';
  const { board, error, loading } = useBoard(open, savedAtMs);
  const meta = boardMeta(open);
  const god = godOf(sim, simContext);
  const standings = board?.standings ?? [];
  const best = standings.reduce<StandingRow | null>(
    (a, b) => (a === null || b.rank < a.rank ? b : a),
    null,
  );
  const hasLevel = open !== 'wealth';
  const rows = board?.board === open ? board.rows : [];
  return (
    <>
      <ScreenHead
        icon={HIGHSCORES_ICON}
        title="Highscores"
        chip={board ? `${String(board.players)} names on the hill` : 'reading the register'}
        rate={
          best
            ? `your best: #${String(best.rank)} in ${boardMeta(best.board).name.toLowerCase()}`
            : 'your first save puts you on the board'
        }
      />
      <div className="scores-columns">
        <div className="card list scores-standing">
          <div className="card-head">
            <Label>Your standing</Label>
            <span className="spacer" />
            <span className="hint">rank · level · xp</span>
          </div>
          {ids.map((id) => (
            <StandingRowView
              key={id}
              id={id}
              standing={standings.find((s) => s.board === id) ?? null}
              active={id === open}
              onPick={onBoard}
            />
          ))}
        </div>

        <div className="card list scores-board">
          <div className="card-head">
            <UiIcon id={meta.icon} size={14} />
            <Label style={{ marginLeft: 8 }}>{meta.name}</Label>
            <span className="spacer" />
            <span className="hint">{meta.hint}</span>
          </div>
          <div className="board-head">
            <span className="rank">#</span>
            <span className="body">Name</span>
            {hasLevel && <span className="lvl">Level</span>}
            <span className="score">{meta.unit}</span>
          </div>
          {error && (
            <div className="row board-note warn" role="alert">
              {board ? `the board could not be re-read: ${error}` : error}
            </div>
          )}
          {!error && rows.length === 0 && (
            <div className="row board-note">
              {loading ? 'reading the register…' : 'nobody has saved on this board yet'}
            </div>
          )}
          {rows.map((r) => {
            const sworn = r.god !== null && content.hasGod(r.god) ? content.god(r.god) : null;
            const mine = r.you ? god : sworn;
            return (
              <div
                key={r.you ? 'you' : `${String(r.rank)}:${r.name}`}
                className={`row board-row${r.you ? ' you' : ''}${r.rank === 1 ? ' first' : ''}`}
              >
                <span className="rank">{String(r.rank)}</span>
                <Face name={r.name} size={22} />
                <span className="god" title={mine ? `sworn to ${mine.name}` : 'sworn to nobody'}>
                  {mine ? <UiIcon id={mine.icon} size={12} /> : <span className="none">·</span>}
                </span>
                <span className="body">
                  <span className="name">
                    {r.name}
                    {r.you && <span className="tag-active">you</span>}
                  </span>
                  <span className="sub">
                    {r.you
                      ? mine
                        ? `sworn to ${mine.name}`
                        : 'sworn to nobody'
                      : `${mine ? `sworn to ${mine.name} · ` : ''}${seenLine(r.seenAgoMs)}`}
                  </span>
                </span>
                {hasLevel && <span className="lvl">{String(r.level ?? '')}</span>}
                <span className="score">{formatInt(r.score)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function StandingRowView({
  id,
  standing: s,
  active,
  onPick,
}: {
  id: BoardId;
  standing: StandingRow | null;
  active: boolean;
  onPick: (id: BoardId) => void;
}) {
  const meta = boardMeta(id);
  return (
    <button className={`row standing${active ? ' active' : ''}`} onClick={() => onPick(id)}>
      <UiIcon id={meta.icon} size={16} />
      <span className="body">
        <span className="name">{meta.name}</span>
      </span>
      <span className={s?.rank === 1 ? 'rank first' : 'rank'}>
        {s ? `#${String(s.rank)}` : '—'}
      </span>
      <span className="lvl">{s?.level == null ? '—' : String(s.level)}</span>
      <span className="score">{s ? formatInt(s.score) : '—'}</span>
    </button>
  );
}
