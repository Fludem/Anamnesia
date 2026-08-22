/**
 * The frame around every screen: sidebar (wide) or top bar + bottom tabs (narrow), from
 * Screens A and C. Navigation only — it reads levels and coins, nothing else.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { content, simContext } from '../content/index.ts';
import type { SimState } from '../sim/save.ts';
import { skillView } from './derive.ts';
import { formatInt } from './format.ts';
import { Label, UiIcon } from './parts.tsx';
import type { View } from './prefs.ts';
import { HIGHSCORES_ICON } from './screens/HighscoresScreen.tsx';

export const BANK_ICON = 'delapouite/chest';
export const COIN_ICON = 'delapouite/coins';
export const EQUIPMENT_ICON = 'delapouite/chest-armor';
export const TRADER_ICON = 'lorc/scales';

/** Skills with a screen of their own; hitpoints is read on the combat screen. */
const LISTED = content.skills.filter((s) => s.listed);

/** Bottom-tab captions: the design writes "Mine / Wood / Fish / Fire / Smith / Fight / Bank". */
const TAB_LABEL: Record<string, string> = {
  mining: 'Mine',
  woodcutting: 'Wood',
  fishing: 'Fish',
  foraging: 'Forage',
  firemaking: 'Fire',
  cooking: 'Cook',
  smithing: 'Smith',
  combat: 'Fight',
};

export interface ShellProps {
  sim: SimState;
  view: View;
  onView: (view: View) => void;
  onSettings: () => void;
  children: ReactNode;
}

export function Shell({ sim, view, onView, onSettings, children }: ShellProps) {
  const isSkill = (id: string) => view.kind === 'skill' && view.id === id;
  const coins = formatInt(sim.coins);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ANAMNESIA</span>
        <span className="brand-sub">IDLE</span>
        <span className="spacer" />
        <span className="coins">
          <UiIcon id={COIN_ICON} size={14} className="gold" />
          {coins}
        </span>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div style={{ padding: '2px 10px 12px' }}>
            <div className="brand">ANAMNESIA</div>
            <div className="brand-sub">IDLE</div>
          </div>
          <div className="coins">
            <UiIcon id={COIN_ICON} size={15} className="gold" />
            {coins}
            <span className="unit">gp</span>
          </div>
          <Label className="side-label">Skills</Label>
          {LISTED.map((skill) => (
            <button
              key={skill.id}
              className={isSkill(skill.id) ? 'nav-row active' : 'nav-row'}
              onClick={() => onView({ kind: 'skill', id: skill.id })}
            >
              <UiIcon id={skill.icon} size={17} />
              <span className="grow">{skill.name}</span>
              <span className="lvl">{skillView(sim, skill.id, simContext).level}</span>
            </button>
          ))}
          <div className="divider" />
          <button
            className={view.kind === 'bank' ? 'nav-row active' : 'nav-row'}
            onClick={() => onView({ kind: 'bank' })}
          >
            <UiIcon id={BANK_ICON} size={17} />
            <span className="grow">Bank</span>
            <span className="lvl">{sim.bank.length}</span>
          </button>
          <button
            className={view.kind === 'equipment' ? 'nav-row active' : 'nav-row'}
            onClick={() => onView({ kind: 'equipment' })}
          >
            <UiIcon id={EQUIPMENT_ICON} size={17} />
            <span className="grow">Equipment</span>
          </button>
          <button
            className={view.kind === 'trader' ? 'nav-row active' : 'nav-row'}
            onClick={() => onView({ kind: 'trader' })}
          >
            <UiIcon id={TRADER_ICON} size={17} />
            <span className="grow">Trader</span>
          </button>
          <button
            className={view.kind === 'highscores' ? 'nav-row active' : 'nav-row'}
            onClick={() =>
              onView(view.kind === 'highscores' ? view : { kind: 'highscores', board: 'total' })
            }
          >
            <UiIcon id={HIGHSCORES_ICON} size={17} />
            <span className="grow">Highscores</span>
          </button>
          <div className="spacer" />
          <AvatarMenu name={sim.player.name} onSettings={onSettings} />
        </aside>

        <main className="main">{children}</main>
      </div>

      <nav className="tabbar">
        {LISTED.map((skill) => (
          <button
            key={skill.id}
            className={isSkill(skill.id) ? 'tab active' : 'tab'}
            onClick={() => onView({ kind: 'skill', id: skill.id })}
          >
            <UiIcon id={skill.icon} size={20} />
            {TAB_LABEL[skill.id] ?? skill.name.slice(0, 5)}
          </button>
        ))}
        <button
          className={view.kind === 'bank' ? 'tab active' : 'tab'}
          onClick={() => onView({ kind: 'bank' })}
        >
          <UiIcon id={BANK_ICON} size={20} />
          Bank
        </button>
        <button
          className={view.kind === 'equipment' ? 'tab active' : 'tab'}
          onClick={() => onView({ kind: 'equipment' })}
        >
          <UiIcon id={EQUIPMENT_ICON} size={20} />
          Gear
        </button>
        <button
          className={view.kind === 'trader' ? 'tab active' : 'tab'}
          onClick={() => onView({ kind: 'trader' })}
        >
          <UiIcon id={TRADER_ICON} size={20} />
          Trade
        </button>
        <button
          className={view.kind === 'highscores' ? 'tab active' : 'tab'}
          onClick={() =>
            onView(view.kind === 'highscores' ? view : { kind: 'highscores', board: 'total' })
          }
        >
          <UiIcon id={HIGHSCORES_ICON} size={20} />
          Scores
        </button>
        <button className="tab" onClick={onSettings}>
          <UiIcon id="lorc/cog" size={20} />
          More
        </button>
      </nav>
    </div>
  );
}

function AvatarMenu({ name, onSettings }: { name: string; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="avatar-wrap" ref={ref}>
      {open && (
        <div className="menu">
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <UiIcon id="lorc/cog" size={14} />
            Settings
          </button>
        </div>
      )}
      <button className="nav-row avatar-row" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="name">{name}</span>
        <span className={open ? 'caret open' : 'caret'}>▾</span>
      </button>
    </div>
  );
}
