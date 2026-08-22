import { useState } from 'react';
import type { User } from './api/protocol.ts';
import type { Command } from './sim/commands.ts';
import { oathsReleased } from './sim/trader.ts';
import { simContext } from './content/index.ts';
import { nightHours } from './ui/derive-trader.ts';
import { recentLevelUp } from './ui/derive.ts';
import { AuthPage } from './ui/overlays/Auth.tsx';
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
import { EquipmentScreen } from './ui/screens/EquipmentScreen.tsx';
import { CRAFT_SKILLS, GATHER_SKILLS } from './ui/screens/defs.ts';
import { FirstSteps } from './ui/screens/FirstSteps.tsx';
import { GatherScreen } from './ui/screens/GatherScreen.tsx';
import { HighscoresScreen } from './ui/screens/HighscoresScreen.tsx';
import { TraderScreen } from './ui/screens/TraderScreen.tsx';
import { Shell } from './ui/Shell.tsx';
import { useGameRuntime } from './ui/useGameHost.ts';
import { useSession } from './ui/useSession.ts';
import './ui/app.css';

const LEVEL_UP_TICKS = 40;
const DEFAULT_VIEW: View = { kind: 'skill', id: 'mining' };

/**
 * The door: who is logged in decides whether the tab shows the login card or the game. The
 * game is keyed by the name so a different login gets a fresh runtime.
 */
export function App() {
  const door = useSession();
  const { session } = door;
  if (session.kind === 'checking') return <BootingPage />;
  if (session.kind === 'out')
    return <AuthPage notice={session.error} onLogin={door.login} onRegister={door.register} />;
  return <Game key={session.user.id} user={session.user} onSignOut={door.signOut} />;
}

/**
 * Chooses what the tab shows: one of the calm full-page states while the runtime is not ready
 * to play here, otherwise the shell with the current screen and any moment-overlays on top.
 */
function Game({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const { runtime, snapshot } = useGameRuntime(user);
  const [juice, setJuice] = usePref('juice', JuiceSchema, 'juicy');
  const [view, setView] = usePref('view', ViewSchema, DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sim, role } = snapshot;
  const reload = () => runtime?.env.reloadPage();
  /** Save, stop the game here, then end the session: the last save is the one that counts. */
  const signOut = async () => {
    if (runtime) {
      await runtime.host.saveNow();
      runtime.host.stop();
    }
    await onSignOut();
  };

  if (snapshot.error !== null) return <ErrorPage message={snapshot.error} onReload={reload} />;
  if (role === 'stale') return <StalePage onReload={reload} />;
  if (role === 'handing-over') return <HandingOverPage />;
  if (role === 'follower')
    return <FollowerPage snapshot={snapshot} onTakeOver={() => runtime?.host.takeOver()} />;
  if (snapshot.catchUp)
    return <CatchUpPage done={snapshot.catchUp.done} total={snapshot.catchUp.total} />;
  if (runtime === null || sim === null || role !== 'leader') return <BootingPage />;

  const dispatch = (cmd: Command) => runtime.host.dispatch(cmd);
  if (sim.player.god === null) {
    return (
      <Onboarding
        heroName={sim.player.name}
        nightHours={nightHours(sim, simContext)}
        onSwear={(god) => {
          dispatch({ type: 'player:swear', god });
          // A new hero starts where first steps start, whatever this browser last looked at;
          // one released from an oath goes back to where they were.
          if (oathsReleased(sim, simContext) === 0) setView(DEFAULT_VIEW);
        }}
      />
    );
  }

  const gather = view.kind === 'skill' ? GATHER_SKILLS[view.id] : undefined;
  const craft = view.kind === 'skill' ? CRAFT_SKILLS[view.id] : undefined;
  const screen =
    view.kind === 'bank' ? (
      <BankScreen sim={sim} dispatch={dispatch} juice={juice} />
    ) : view.kind === 'equipment' ? (
      <EquipmentScreen sim={sim} dispatch={dispatch} juice={juice} />
    ) : view.kind === 'trader' ? (
      <TraderScreen sim={sim} dispatch={dispatch} juice={juice} />
    ) : view.kind === 'highscores' ? (
      <HighscoresScreen
        sim={sim}
        board={view.board}
        onBoard={(board) => setView({ kind: 'highscores', board })}
        savedAtMs={snapshot.lastSavedAtMs}
      />
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
          user={user}
          juice={juice}
          onJuice={setJuice}
          onSignOut={signOut}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
