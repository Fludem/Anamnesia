import { useState } from 'react';
import type { Command } from './sim/commands.ts';
import { DEFAULT_PLAYER_NAME } from './sim/save.ts';
import { recentLevelUp } from './ui/derive.ts';
import {
  BootingPage,
  CatchUpPage,
  ErrorPage,
  FollowerPage,
  HandingOverPage,
  Onboarding,
  StalePage,
} from './ui/overlays/Calm.tsx';
import { LevelUp } from './ui/overlays/LevelUp.tsx';
import { OfflineRecap } from './ui/overlays/OfflineRecap.tsx';
import { Settings } from './ui/overlays/Settings.tsx';
import { JuiceSchema, usePref, ViewSchema, type View } from './ui/prefs.ts';
import { BankScreen } from './ui/screens/BankScreen.tsx';
import { CombatScreen } from './ui/screens/CombatScreen.tsx';
import { CraftScreen } from './ui/screens/CraftScreen.tsx';
import { CRAFT_SKILLS, GATHER_SKILLS } from './ui/screens/defs.ts';
import { FirstSteps } from './ui/screens/FirstSteps.tsx';
import { GatherScreen } from './ui/screens/GatherScreen.tsx';
import { Shell } from './ui/Shell.tsx';
import { useGameRuntime } from './ui/useGameHost.ts';
import './ui/app.css';

const LEVEL_UP_TICKS = 40;
const DEFAULT_VIEW: View = { kind: 'skill', id: 'mining' };

/**
 * Chooses what the tab shows: one of the calm full-page states while the runtime is not ready
 * to play here, otherwise the shell with the current screen and any moment-overlays on top.
 */
export function App() {
  const { runtime, snapshot } = useGameRuntime();
  const [juice, setJuice] = usePref('juice', JuiceSchema, 'juicy');
  const [view, setView] = usePref('view', ViewSchema, DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sim, role } = snapshot;
  const reload = () => runtime?.env.reloadPage();

  if (snapshot.error !== null) return <ErrorPage message={snapshot.error} onReload={reload} />;
  if (role === 'stale') return <StalePage onReload={reload} />;
  if (role === 'handing-over') return <HandingOverPage />;
  if (role === 'follower')
    return <FollowerPage snapshot={snapshot} onTakeOver={() => runtime?.host.takeOver()} />;
  if (snapshot.catchUp)
    return <CatchUpPage done={snapshot.catchUp.done} total={snapshot.catchUp.total} />;
  if (runtime === null || sim === null || role !== 'leader') return <BootingPage />;

  const dispatch = (cmd: Command) => runtime.host.dispatch(cmd);
  if (sim.player.name === DEFAULT_PLAYER_NAME || sim.player.god === null) {
    return (
      <Onboarding
        name={sim.player.name === DEFAULT_PLAYER_NAME ? null : sim.player.name}
        onName={(name) => dispatch({ type: 'player:rename', name })}
        onSwear={(god) => {
          dispatch({ type: 'player:swear', god });
          // A new hero starts where first steps start, whatever this browser last looked at.
          setView(DEFAULT_VIEW);
        }}
      />
    );
  }

  const gather = view.kind === 'skill' ? GATHER_SKILLS[view.id] : undefined;
  const craft = view.kind === 'skill' ? CRAFT_SKILLS[view.id] : undefined;
  const screen =
    view.kind === 'bank' ? (
      <BankScreen sim={sim} dispatch={dispatch} juice={juice} />
    ) : gather ? (
      <GatherScreen key={gather.skill} sim={sim} dispatch={dispatch} juice={juice} def={gather} />
    ) : craft ? (
      <CraftScreen key={craft.skill} sim={sim} dispatch={dispatch} juice={juice} def={craft} />
    ) : view.id === 'combat' ? (
      <CombatScreen sim={sim} dispatch={dispatch} juice={juice} />
    ) : (
      <GatherScreen sim={sim} dispatch={dispatch} juice={juice} def={GATHER_SKILLS['mining']!} />
    );

  const levelUp = juice === 'deadpan' ? null : recentLevelUp(sim, LEVEL_UP_TICKS);

  return (
    <div className={juice}>
      <Shell sim={sim} view={view} onView={setView} onSettings={() => setSettingsOpen(true)}>
        {snapshot.commandError && (
          <div className="toast stop" role="alert" style={{ margin: '0 0 14px' }}>
            <span className="kind">COULD NOT</span>
            <span className="name">{snapshot.commandError}</span>
          </div>
        )}
        {!sim.tutorial.dismissed && (
          <FirstSteps sim={sim} view={view} onGo={setView} dispatch={dispatch} juice={juice} />
        )}
        {screen}
      </Shell>

      {levelUp && (
        <LevelUp key={`${String(levelUp.tick)}:${levelUp.skill}`} event={levelUp} juice={juice} />
      )}
      {snapshot.offline && (
        <OfflineRecap
          info={snapshot.offline}
          sim={sim}
          juice={juice}
          onCollect={() => runtime.host.dismissOffline()}
        />
      )}
      {settingsOpen && (
        <Settings
          runtime={runtime}
          snapshot={snapshot}
          juice={juice}
          onJuice={setJuice}
          onRename={(name) => dispatch({ type: 'player:rename', name })}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
