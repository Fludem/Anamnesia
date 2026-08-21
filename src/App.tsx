import { Icon } from './icons/Icon.tsx';
import { icons } from './icons/registry.ts';

/** Phase 0 placeholder: proves the shipped icon subset renders. The game arrives in Phase 1+. */
export function App() {
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>Anamnesia Idle</h1>
      <p style={{ color: 'var(--fg-muted)' }}>
        Phase 0 — asset pipeline. {icons.size} icons shipped from game-icons@
        <code>{icons.source.commit.slice(0, 8)}</code>. Dev icon browser:{' '}
        {import.meta.env.DEV ? <a href="/dev/icons.html">/dev/icons.html</a> : <em>dev only</em>}.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
        {icons.all().map((icon) => (
          <div
            key={icon.id}
            title={icon.id}
            style={{
              width: 72,
              height: 72,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <Icon icon={icon} size={44} title={icon.id} />
          </div>
        ))}
      </div>
    </main>
  );
}
