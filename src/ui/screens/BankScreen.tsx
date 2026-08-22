/** Screen C — the bank: grid, filters, search, selection, sell, open, equip. */
import { useState } from 'react';
import { content } from '../../content/index.ts';
import { bankCapacity, bankSlotCost, bankWorth } from '../../sim/bank.ts';
import type { ItemDef, StatKey } from '../../sim/content/schema.ts';
import { eventsOfType } from '../../sim/events.ts';
import { countItem } from '../../sim/items.ts';
import type { SimState } from '../../sim/save.ts';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '../../sim/slots.ts';
import { formatInt, formatShort } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec } from '../items/spec.ts';
import { Badges, ItemGlyph, Label, Pops, TileBox, UiIcon } from '../parts.tsx';
import { popX } from '../util.ts';
import { Modal } from '../overlays/Modal.tsx';
import { BANK_ICON } from '../Shell.tsx';
import type { ScreenProps } from './defs.ts';
import { ScreenHead } from './common.tsx';

interface Filter {
  id: string;
  label: string;
  match: (item: ItemDef) => boolean;
}
const GEAR = new Set(['weapon', 'armour', 'tool']);
const SPECIFIC: Filter[] = [
  { id: 'ores', label: 'Ores', match: (i) => i.tags.includes('ore') || i.tags.includes('stone') },
  { id: 'logs', label: 'Logs', match: (i) => i.tags.includes('log') },
  { id: 'bars', label: 'Bars', match: (i) => i.tags.includes('bar') },
  { id: 'gear', label: 'Gear', match: (i) => GEAR.has(i.class) },
  { id: 'gems', label: 'Gems', match: (i) => i.class === 'gem' },
  {
    id: 'food',
    label: 'Food',
    match: (i) => i.tags.includes('fish') || (i.stats.heal ?? 0) > 0,
  },
  { id: 'offerings', label: 'Offerings', match: (i) => (i.stats.favour ?? 0) > 0 },
];
const FILTERS: Filter[] = [
  { id: 'all', label: 'All', match: () => true },
  ...SPECIFIC,
  { id: 'misc', label: 'Misc', match: (i) => !SPECIFIC.some((f) => f.match(i)) },
];

const STAT_LABEL: Record<StatKey, string> = {
  attack: 'attack',
  strength: 'strength',
  defence: 'defence',
  speed: 'speed',
  gather: 'action time',
  heal: 'heals',
  favour: 'favour',
};

export function BankScreen({ sim, dispatch, juice }: ScreenProps) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sellX, setSellX] = useState(false);
  const [sold, setSold] = useState(0);
  const [pops, setPops] = useState<{ key: string; text: string; x: number; at: number }[]>([]);
  const livePops = pops.filter((p) => sim.tick - p.at < 11);

  const capacity = bankCapacity(sim);
  const used = sim.bank.length;
  const worth = bankWorth(sim, (id) => content.item(id).value);
  const slotCost = bankSlotCost(sim.bankSlotsBought);
  const canBuy = sim.coins >= slotCost;

  const q = query.trim().toLowerCase();
  const match = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;
  const visible = sim.bank
    .map((s) => ({ item: content.item(s.item), qty: s.qty }))
    .filter(({ item }) => match.match(item) && (!q || item.name.toLowerCase().includes(q)));

  // A selection whose stack is gone (sold out, opened, equipped) simply stops being one.
  const held = selected !== null && countItem(sim.bank, selected) > 0 ? selected : null;
  const sel = held !== null && content.hasItem(held) ? content.item(held) : null;
  const selQty = sel ? countItem(sim.bank, sel.id) : 0;

  const pop = (text: string) => {
    if (juice === 'deadpan') return;
    const at = sim.tick;
    setPops((p) => [
      ...p.filter((x) => at - x.at < 11),
      { key: `${String(at)}:${String(p.length)}`, text, x: popX(at + p.length), at },
    ]);
  };
  const sell = (n: number) => {
    if (!sel || n <= 0) return;
    dispatch({ type: 'sell', item: sel.id, qty: n });
    setSold((s) => s + n * sel.value);
    pop(`+${formatInt(n * sel.value)} gp`);
  };

  return (
    <>
      <ScreenHead
        icon={BANK_ICON}
        title="Bank"
        chip={`${String(used)} / ${String(capacity)} slots`}
        rate={`worth ${formatInt(worth)} gp`}
      />
      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={f.id === filter ? 'filter active' : 'filter'}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span className="spacer" />
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search items…"
          aria-label="Search items"
        />
      </div>

      <div className="columns" style={{ marginTop: 14 }}>
        <div className="col-main">
          <div className="card bank-card">
            {used === 0 ? (
              <div className="bank-empty">
                <div className="lead">The bank is empty.</div>
                Everything you gather and smith lands here. It stays put.
              </div>
            ) : (
              <div className="grid">
                {visible.map(({ item, qty }) => (
                  <button
                    key={item.id}
                    className={`cell ${item.rarity}${item.id === held ? ' selected' : ''}`}
                    onClick={() => setSelected(item.id)}
                    title={`${item.name} · ${item.description}`}
                  >
                    <ItemGlyph item={item} size={26} />
                    <span className="qty">{formatShort(qty)}</span>
                    {content.rarity(item.rarity).tag && (
                      <span className="tag">{content.rarity(item.rarity).tag}</span>
                    )}
                    <Badges kinds={item.badges} />
                  </button>
                ))}
                {filter === 'all' &&
                  !q &&
                  Array.from({ length: Math.max(0, capacity - used) }, (_, i) => (
                    <div key={`empty-${String(i)}`} className="cell empty" />
                  ))}
                {filter === 'all' && !q && (
                  <button
                    className={canBuy ? 'cell buy can' : 'cell buy'}
                    disabled={!canBuy}
                    title={
                      canBuy ? 'buy 1 extra bank slot' : `a slot costs ${formatInt(slotCost)} gp`
                    }
                    onClick={() => {
                      dispatch({ type: 'bank:buy-slot' });
                      pop(`−${formatInt(slotCost)} gp`);
                    }}
                  >
                    <span className="plus">+</span>
                    <span className="cost">{formatInt(slotCost)} gp</span>
                  </button>
                )}
                {visible.length === 0 && used > 0 && (
                  <div className="bank-empty" style={{ gridColumn: '1 / -1' }}>
                    Nothing matches.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="col-side">
          <div className="card selected-card">
            <Label>Selected</Label>
            {sel ? (
              <>
                <div className="active-head">
                  <TileBox size="xl">
                    <BareIcon spec={itemIconSpec(content, sel)} size={34} />
                  </TileBox>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">{sel.name}</div>
                    <div className="sub">
                      {sel.class} · {sel.rarity}
                      {sel.slot ? ` · ${sel.slot}` : ''}
                    </div>
                  </div>
                </div>
                <div className="desc">{sel.description}</div>
                <div className="stat-block">
                  <StatRow k="quantity" v={formatInt(selQty)} />
                  <StatRow k="unit value" v={`${formatInt(sel.value)} gp`} />
                  <StatRow k="stack value" v={`${formatInt(selQty * sel.value)} gp`} gold />
                  {(Object.entries(sel.stats) as [StatKey, number][]).map(([k, v]) => (
                    <StatRow
                      key={k}
                      k={STAT_LABEL[k]}
                      v={k === 'gather' ? `−${String(v)}%` : `+${String(v)}`}
                      accent
                    />
                  ))}
                </div>
                {sel.opens !== null && (
                  <div className="btn-row">
                    <button
                      className="btn primary"
                      onClick={() => dispatch({ type: 'open', item: sel.id, qty: 1 })}
                    >
                      Open 1
                    </button>
                    {selQty > 1 && (
                      <button
                        className="btn primary"
                        onClick={() => dispatch({ type: 'open', item: sel.id, qty: selQty })}
                      >
                        Open all
                      </button>
                    )}
                  </div>
                )}
                {sel.slot !== null && (
                  <button
                    className="btn primary"
                    onClick={() => dispatch({ type: 'equip', item: sel.id })}
                  >
                    Equip
                    {sim.equipment[sel.slot] !== null
                      ? ` · replaces ${content.item(sim.equipment[sel.slot]!).name}`
                      : ''}
                  </button>
                )}
                <div className="btn-row">
                  <button className="btn" onClick={() => sell(1)}>
                    Sell 1
                  </button>
                  <button className="btn gold" onClick={() => setSellX(true)}>
                    Sell X…
                  </button>
                </div>
              </>
            ) : (
              <div className="idle-hint">Select an item to see its details.</div>
            )}
            <Pops pops={livePops} gold />
            <div className="card-foot">sold this session · {formatInt(sold)} gp</div>
          </div>

          <WornCard sim={sim} onUnequip={(slot) => dispatch({ type: 'unequip', slot })} />
        </div>
      </div>

      <LootModal sim={sim} onOpenAgain={(item) => dispatch({ type: 'open', item, qty: 1 })} />

      {sellX && sel && (
        <SellAmount
          item={sel}
          have={selQty}
          onCancel={() => setSellX(false)}
          onSell={(n) => {
            sell(n);
            setSellX(false);
          }}
        />
      )}
    </>
  );
}

function StatRow({
  k,
  v,
  gold,
  accent,
}: {
  k: string;
  v: string;
  gold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="stat-row">
      <span className="k">{k}</span>
      <span className={`v${gold ? ' gold' : ''}${accent ? ' accent' : ''}`}>{v}</span>
    </div>
  );
}

/** Worn equipment. Tool slots always show; other slots only once something is in them. */
function WornCard({ sim, onUnequip }: { sim: SimState; onUnequip: (slot: EquipmentSlot) => void }) {
  const slots = EQUIPMENT_SLOTS.filter(
    (s) => sim.equipment[s] !== null || s === 'pickaxe' || s === 'axe',
  );
  return (
    <div className="card">
      <Label>Worn</Label>
      <div className="worn">
        {slots.map((slot) => {
          const id = sim.equipment[slot];
          const item = id !== null && content.hasItem(id) ? content.item(id) : null;
          return (
            <button
              key={slot}
              className="worn-slot"
              disabled={item === null}
              title={item ? `Unequip ${item.name}` : 'empty'}
              onClick={() => onUnequip(slot)}
            >
              <TileBox size="sm" dim={item === null}>
                {item ? (
                  <BareIcon spec={itemIconSpec(content, item)} size={20} />
                ) : (
                  <UiIcon id="lorc/padlock" size={12} />
                )}
              </TileBox>
              <div className="body">
                <div className="slot">{slot}</div>
                <div className={item ? 'name' : 'name none'}>{item ? item.name : '—'}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="card-foot" style={{ marginTop: 12 }}>
        equip from the bank · click a worn item to take it off
      </div>
    </div>
  );
}

/** "NEST OPENED" — shows the newest `opened` event that happened since this screen mounted. */
function LootModal({ sim, onOpenAgain }: { sim: SimState; onOpenAgain: (item: string) => void }) {
  const [mountTick] = useState(() => sim.tick);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const opened = eventsOfType(sim, 'opened');
  const last = opened[opened.length - 1];
  if (!last || last.tick < mountTick) return null;
  const key = `${String(last.tick)}:${last.item}:${String(last.qty)}:${String(opened.length)}`;
  if (key === dismissed) return null;
  const container = content.item(last.item);
  const left = countItem(sim.bank, last.item);
  return (
    <Modal tone="rare" onClose={() => setDismissed(key)}>
      <Label className="rare">{container.name.toUpperCase()} OPENED</Label>
      {last.items.map((s) => {
        const item = content.item(s.item);
        return (
          <div key={s.item} className="loot-row">
            <TileBox size="lg">
              <BareIcon spec={itemIconSpec(content, item)} size={26} />
            </TileBox>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="name">{item.name}</div>
              <div className="sub">
                {last.qty > 1 ? `from ${String(last.qty)} ${container.name}` : 'added to bank'}
              </div>
            </div>
            <span className="n">×{formatInt(s.qty)}</span>
          </div>
        );
      })}
      {last.items.length === 0 && (
        <div className="loot-row">
          <div className="sub">Empty. It happens.</div>
        </div>
      )}
      <div className="foot">
        <button className="btn quiet" style={{ flex: 1 }} onClick={() => setDismissed(key)}>
          Close
        </button>
        {left > 0 && (
          <button
            className="btn primary wide"
            style={{ flex: 1.4 }}
            onClick={() => onOpenAgain(last.item)}
          >
            Open another ({formatInt(left)})
          </button>
        )}
      </div>
    </Modal>
  );
}

function SellAmount({
  item,
  have,
  onCancel,
  onSell,
}: {
  item: ItemDef;
  have: number;
  onCancel: () => void;
  onSell: (n: number) => void;
}) {
  const [raw, setRaw] = useState(String(Math.min(10, have) || 1));
  const n = Math.min(parseInt(raw, 10) || 0, have);
  return (
    <Modal onClose={onCancel}>
      <Label>Sell amount</Label>
      <div className="active-head" style={{ marginTop: 12 }}>
        <TileBox size="lg">
          <BareIcon spec={itemIconSpec(content, item)} size={24} />
        </TileBox>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="title" style={{ fontSize: 14 }}>
            {item.name}
          </div>
          <div className="sub">
            {formatInt(have)} in bank · {formatInt(item.value)} gp each
          </div>
        </div>
      </div>
      <input
        className="amount"
        inputMode="numeric"
        value={raw}
        autoFocus
        onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && n > 0) onSell(n);
          if (e.key === 'Escape') onCancel();
        }}
        aria-label="Amount to sell"
      />
      <div className="chips">
        {[10, 100, 1000].map((v) => (
          <button key={v} className="btn sm" onClick={() => setRaw(String(Math.min(v, have)))}>
            {String(v)}
          </button>
        ))}
        <button className="btn sm" onClick={() => setRaw(String(have))}>
          ALL
        </button>
      </div>
      <div className="total">{n > 0 ? `= ${formatInt(n * item.value)} gp` : '—'}</div>
      <div className="foot" style={{ marginTop: 12 }}>
        <button className="btn quiet" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={n <= 0}
          onClick={() => onSell(n)}
        >
          Sell
        </button>
      </div>
    </Modal>
  );
}
