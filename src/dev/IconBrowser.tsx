/**
 * Dev-only icon browser. Lazy-loads the full 4k-icon index (never part of the game bundle),
 * searches it with the same `searchIcons` the game will use, and renders a windowed grid so only
 * visible rows exist in the DOM.
 */

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../icons/Icon.tsx';
import { searchIcons, tokenize } from '../icons/search.ts';
import { IconIndexSchema, type IconEntry, type IconIndex, type License } from '../icons/types.ts';

const CELL = 96;
const ICON_SIZE = 48;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: IconIndex };

function useFullIndex(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    import('../assets/icon-index.json')
      .then((mod) => {
        if (cancelled) return;
        setState({ status: 'ready', index: IconIndexSchema.parse(mod.default) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function IconBrowser() {
  const load = useFullIndex();
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState<'' | License>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const all = useMemo(() => (load.status === 'ready' ? load.index.icons : []), [load]);
  const authors = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const i of all) {
      const a = counts.get(i.author) ?? { name: i.authorName, count: 0 };
      a.count += 1;
      counts.set(i.author, a);
    }
    return [...counts].sort((x, y) => y[1].count - x[1].count);
  }, [all]);

  const results = useMemo(
    () =>
      searchIcons(all, {
        query: deferredQuery,
        author: author || undefined,
        license: license || undefined,
      }),
    [all, deferredQuery, author, license],
  );

  const selected = useMemo(() => all.find((i) => i.id === selectedId) ?? null, [all, selectedId]);

  return (
    <div className="ib-layout">
      <div className="ib-toolbar">
        <strong>Icon browser</strong>
        <input
          type="search"
          placeholder="Search by name, tag, or author… (e.g. sword, ore, lorc)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <select value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">All authors</option>
          {authors.map(([dir, a]) => (
            <option key={dir} value={dir}>
              {a.name} ({a.count})
            </option>
          ))}
        </select>
        <select value={license} onChange={(e) => setLicense(e.target.value as '' | License)}>
          <option value="">Any licence</option>
          <option value="CC-BY-3.0">CC BY 3.0</option>
          <option value="CC0-1.0">CC0</option>
        </select>
        <span className="ib-count">
          {load.status === 'ready'
            ? `${results.length.toLocaleString()} / ${all.length.toLocaleString()}`
            : '…'}
        </span>
      </div>

      {load.status === 'loading' && <div className="ib-empty">Loading icon index…</div>}
      {load.status === 'error' && (
        <div className="ib-empty">Failed to load index: {load.message}</div>
      )}
      {load.status === 'ready' && (
        <WindowedGrid items={results} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      <aside className="ib-detail">
        {selected ? (
          <Detail key={selected.id} icon={selected} />
        ) : (
          <p style={{ color: 'var(--fg-muted)' }}>Select an icon.</p>
        )}
      </aside>
    </div>
  );
}

function WindowedGrid({
  items,
  selectedId,
  onSelect,
}: {
  items: IconEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setViewport({ width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  // Reset scroll when the result set changes so the user sees the top of the new results.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [items]);

  const cols = Math.max(1, Math.floor((viewport.width - 16) / CELL));
  const rowCount = Math.ceil(items.length / cols);
  const firstRow = Math.max(0, Math.floor(viewport.scrollTop / CELL) - 1);
  const lastRow = Math.min(rowCount, Math.ceil((viewport.scrollTop + viewport.height) / CELL) + 1);

  const rows = [];
  for (let r = firstRow; r < lastRow; r += 1) {
    rows.push(
      <div key={r} className="ib-row" style={{ top: r * CELL }}>
        {items.slice(r * cols, (r + 1) * cols).map((icon) => (
          <div
            key={icon.id}
            className={`ib-cell${icon.id === selectedId ? ' selected' : ''}`}
            style={{ '--cell': `${CELL}px` } as React.CSSProperties}
            title={icon.id}
            onClick={() => onSelect(icon.id)}
          >
            <Icon icon={icon} size={ICON_SIZE} />
          </div>
        ))}
      </div>,
    );
  }

  return (
    <div ref={ref} className="ib-grid">
      {items.length === 0 ? (
        <div className="ib-empty">No icons match.</div>
      ) : (
        <div style={{ height: rowCount * CELL, position: 'relative' }}>{rows}</div>
      )}
    </div>
  );
}

function Detail({ icon }: { icon: IconEntry }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(icon.id).then(() => setCopied(true));
  };
  return (
    <div>
      <div className="ib-preview">
        <Icon icon={icon} size={128} />
        <Icon icon={icon} size={64} />
        <Icon icon={icon} size={32} />
        <Icon icon={icon} size={16} />
      </div>
      <dl>
        <dt>id</dt>
        <dd>
          <code>{icon.id}</code>
        </dd>
        <dt>author</dt>
        <dd>
          {icon.authorUrl ? (
            <a href={icon.authorUrl} target="_blank" rel="noreferrer">
              {icon.authorName}
            </a>
          ) : (
            icon.authorName
          )}
        </dd>
        <dt>licence</dt>
        <dd>{icon.license}</dd>
        <dt>words</dt>
        <dd className="ib-tags">
          {tokenize(icon.slug).map((t) => (
            <span key={t} className="ib-tag">
              {t}
            </span>
          ))}
        </dd>
        <dt>tags</dt>
        <dd className="ib-tags">
          {icon.tags.length === 0 ? <span style={{ color: 'var(--fg-muted)' }}>none</span> : null}
          {icon.tags.map((t) => (
            <span key={t} className="ib-tag">
              {t}
            </span>
          ))}
        </dd>
        <dt>path</dt>
        <dd style={{ color: 'var(--fg-muted)' }}>{icon.d.length.toLocaleString()} chars</dd>
      </dl>
      <button className="primary" onClick={copy}>
        {copied ? 'Copied' : 'Copy id'}
      </button>
    </div>
  );
}
