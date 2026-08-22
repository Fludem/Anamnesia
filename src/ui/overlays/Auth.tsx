/**
 * Screen D's first two states on the calm card: log in, or make a name. A name and a password
 * are all the register asks. The name is the hero's — there is no separate account name — so
 * the old "name your hero" step is this form.
 */
import { useState, type FormEvent } from 'react';
import { PlayerNameSchema } from '../../sim/commands.ts';
import { PasswordSchema, type Credentials } from '../../api/protocol.ts';
import { Label } from '../parts.tsx';
import { CalmPage } from './Calm.tsx';

export interface AuthPageProps {
  /** Why the last check of the register failed, if it did. */
  notice: string | null;
  onLogin: (creds: Credentials) => Promise<string | null>;
  onRegister: (creds: Credentials) => Promise<string | null>;
}

type Mode = 'login' | 'register';

export function AuthPage({ notice, onLogin, onRegister }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = PlayerNameSchema.safeParse(name);
  const passwordOk = PasswordSchema.safeParse(password);
  const letter = name.trim().slice(0, 1).toUpperCase() || '?';
  const canSubmit =
    !busy && nameOk.success && passwordOk.success && (mode === 'login' || again === password);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setAgain('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !nameOk.success) return;
    setBusy(true);
    setError(null);
    const creds = { name: nameOk.data, password };
    const failed = await (mode === 'login' ? onLogin(creds) : onRegister(creds));
    setBusy(false);
    if (failed !== null) setError(failed);
  };

  const hint =
    mode === 'register'
      ? !name
        ? "3–16 characters: letters, numbers, spaces and ' . _ -"
        : !nameOk.success
          ? `name: ${nameOk.error.issues[0]?.message ?? 'not a hero name'}`
          : !passwordOk.success
            ? 'password: at least 8 characters'
            : again !== password
              ? 'the two passwords differ'
              : 'This is what the hill will call you.'
      : null;

  return (
    <CalmPage>
      <form key={mode} className="fade" onSubmit={(e) => void submit(e)}>
        {mode === 'login' ? (
          <>
            <h2>Welcome back</h2>
            <div className="lead">The hill kept going while you were gone.</div>
          </>
        ) : (
          <>
            <h2>Make a name</h2>
            <div className="lead">One name. A lifetime of climbing.</div>
          </>
        )}
        <div className="form">
          <div className="form-row">
            <span className="avatar big">{letter}</span>
            <input
              className="hero"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'login' ? 'Your name' : 'e.g. Sisyphus'}
              maxLength={16}
              autoComplete="username"
              autoFocus
              aria-label="Name"
            />
          </div>
          <label className="field">
            <Label>Password</Label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? '8+ characters' : ''}
              aria-label="Password"
            />
          </label>
          {mode === 'register' && (
            <label className="field">
              <Label>Again</Label>
              <input
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                aria-label="Password again"
              />
            </label>
          )}
        </div>
        {error ? (
          <div className="note warn" role="alert">
            {error}
          </div>
        ) : hint ? (
          <div className="note">{hint}</div>
        ) : notice ? (
          <div className="note warn">{notice}</div>
        ) : null}
        <button className="btn solid" type="submit" disabled={!canSubmit}>
          {busy ? 'One moment' : mode === 'login' ? 'Enter the hill' : 'Begin the climb'}
        </button>
        {mode === 'login' ? (
          <>
            <div className="or">
              <span>new here?</span>
            </div>
            <button className="btn quiet wide" type="button" onClick={() => switchTo('register')}>
              Make a name
            </button>
          </>
        ) : (
          <div className="link-row">
            Already have a name?{' '}
            <button className="linkish" type="button" onClick={() => switchTo('login')}>
              Log in
            </button>
          </div>
        )}
      </form>
    </CalmPage>
  );
}
