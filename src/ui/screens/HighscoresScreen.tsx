/**
 * Highscores: the hero ranked against the hill's other names. Left, the hero's own standing on
 * every board (rank, level, xp) — pick one. Right, that board, best first, the hero's row lit.
 * Nothing here is simulated: the others are curves through the progression model
 * (src/sim/highscores.ts), so the board moves with the game clock and nothing else.
 */
import { content, simContext } from '../../content/index.ts';
import { board, standings, type BoardId, type Standing } from '../../sim/highscores.ts';
import { godOf } from '../../sim/perks.ts';
import type { SimState } from '../../sim/save.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import { ScreenHead } from './common.tsx';

export const HIGHSCORES_ICON = 'lorc/laurel-crown';
const TOTAL_ICON = 'delapouite/stairs-goal';
const WEALTH_ICON = 'delapouite/gold-stack';

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
  const skill = content.skill(id);
  return { name: skill.name, icon: skill.icon, unit: 'xp', hint: `xp in ${skill.name}` };
}

export interface HighscoresScreenProps {
  sim: SimState;
  /** Which board is open; an id the content no longer has falls back to total level. */
  board: BoardId;
  onBoard: (id: BoardId) => void;
}

export function HighscoresScreen({ sim, board: wanted, onBoard }: HighscoresScreenProps) {
  const mine = standings(sim, simContext);
  const open = mine.some((s) => s.board === wanted) ? wanted : 'total';
  const rows = board(sim, open, simContext);
  const meta = boardMeta(open);
  const god = godOf(sim, simContext);
  const best = mine.reduce((a, b) => (b.rank < a.rank ? b : a));
  const hasLevel = open !== 'wealth';
  return (
    <>
      <ScreenHead
        icon={HIGHSCORES_ICON}
        title="Highscores"
        chip={`${String(rows.length)} names on the hill`}
        rate={`your best: #${String(best.rank)} in ${boardMeta(best.board).name.toLowerCase()}`}
      />
      <div className="scores-columns">
        <div className="card list scores-standing">
          <div className="card-head">
            <Label>Your standing</Label>
            <span className="spacer" />
            <span className="hint">rank · level · xp</span>
          </div>
          {mine.map((s) => (
            <StandingRow key={s.board} standing={s} active={s.board === open} onPick={onBoard} />
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
          {rows.map((r) => {
            const you = r.rival === null;
            const sworn = you ? god : r.god === null ? null : content.god(r.god);
            return (
              <div
                key={r.rival ?? 'you'}
                className={`row board-row${you ? ' you' : ''}${r.rank === 1 ? ' first' : ''}`}
                title={r.line ?? undefined}
              >
                <span className="rank">{String(r.rank)}</span>
                <span className="god" title={sworn ? `sworn to ${sworn.name}` : 'sworn to nobody'}>
                  {sworn ? <UiIcon id={sworn.icon} size={12} /> : <span className="none">·</span>}
                </span>
                <span className="body">
                  <span className="name">
                    {r.name}
                    {you && <span className="tag-active">you</span>}
                  </span>
                  <span className="sub">
                    {you ? (sworn ? `sworn to ${sworn.name}` : 'sworn to nobody') : r.line}
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

function StandingRow({
  standing: s,
  active,
  onPick,
}: {
  standing: Standing;
  active: boolean;
  onPick: (id: BoardId) => void;
}) {
  const meta = boardMeta(s.board);
  return (
    <button className={`row standing${active ? ' active' : ''}`} onClick={() => onPick(s.board)}>
      <UiIcon id={meta.icon} size={16} />
      <span className="body">
        <span className="name">{meta.name}</span>
      </span>
      <span className={s.rank === 1 ? 'rank first' : 'rank'}>#{String(s.rank)}</span>
      <span className="lvl">{s.level === null ? '—' : String(s.level)}</span>
      <span className="score">{formatInt(s.score)}</span>
    </button>
  );
}
