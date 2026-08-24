/**
 * Screen E — equipment. The worn body slots in a grid with the attack / strength / defence
 * totals, the toolbelt (one tool per skill, always with you, never lost), and a card for
 * whatever is selected: its numbers, its line, unequip to the bank — or, for an empty slot,
 * what the bank holds that fits.
 */
import { useState } from 'react';
import { content, simContext } from '../../content/index.ts';
import { heroStats } from '../../sim/combat.ts';
import type { ItemDef } from '../../sim/content/schema.ts';
import { godOf } from '../../sim/perks.ts';
import { TOOL_SLOTS, type EquipmentSlot, type ToolSlot } from '../../sim/slots.ts';
import { ammoView, bankItemsFor, wornBody, wornXpBoost, xpBoostText } from '../derive-combat.ts';
import { toolCutPercent } from '../derive.ts';
import { formatInt, formatSigned } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { ScreenHead } from './common.tsx';
import { TOOL_ICON, type ScreenProps } from './defs.ts';

const SLOT_LABEL: Record<EquipmentSlot, string> = {
  weapon: 'Main hand',
  shield: 'Offhand',
  head: 'Head',
  body: 'Body',
  legs: 'Legs',
  hands: 'Hands',
  feet: 'Feet',
  cape: 'Cape',
  amulet: 'Neck',
  ring: 'Ring',
  ammo: 'Ammo',
  pickaxe: 'Pickaxe',
  axe: 'Axe',
  rod: 'Rod',
};

const STAT_LABEL: Record<string, string> = {
  attack: 'attack',
  strength: 'strength',
  defence: 'defence',
  speed: 'swing',
  gather: 'speed',
  heal: 'heals',
};

export function EquipmentScreen({ sim, dispatch }: ScreenProps) {
  const worn = wornBody(sim, content);
  const hero = heroStats(sim, simContext);
  const boost = wornXpBoost(sim, content);
  const god = godOf(sim, simContext);
  const [sel, setSel] = useState<EquipmentSlot>('weapon');
  // On a phone the Selected card is a sheet, raised by a tap on a slot and closed with its ×.
  const [open, setOpen] = useState(false);
  const pick = (slot: EquipmentSlot) => {
    setSel(slot);
    setOpen(true);
  };
  const wornCount = worn.filter((w) => w.item !== null).length;
  const tools = (Object.keys(TOOL_SLOTS) as ToolSlot[]).map((slot) => {
    const id = sim.equipment[slot];
    return { slot, item: id !== null && content.hasItem(id) ? content.item(id) : null };
  });
  const toolCount = tools.filter((t) => t.item !== null).length;
  const selItem = (() => {
    const id = sim.equipment[sel];
    return id !== null && content.hasItem(id) ? content.item(id) : null;
  })();
  return (
    <>
      <ScreenHead
        icon="delapouite/chest-armor"
        title="Equipment"
        chip={`${String(wornCount)}/${String(worn.length)} worn · ${String(toolCount)} tools`}
        rate={god ? `sworn to ${god.name} · ${god.boon}` : null}
      />
      <div className="equip-columns">
        <div className="card">
          <Label>Worn</Label>
          <div className="worn-grid">
            {worn.map(({ slot, item }) => (
              <button
                key={slot}
                className={`worn-cell${item ? ' has' : ''}${sel === slot ? ' on' : ''}`}
                style={{ gridArea: slot }}
                onClick={() => pick(slot)}
                title={item ? item.name : `${SLOT_LABEL[slot]} — empty`}
              >
                {item ? (
                  <BareIcon spec={itemIconSpec(content, item)} size={24} />
                ) : (
                  <UiIcon id="lorc/padlock" size={12} className="empty" />
                )}
                <span className="label">
                  {item
                    ? slot === 'ammo'
                      ? `×${formatInt((ammoView(sim, content)?.inBank ?? 0) + 1)}`
                      : lastWord(item.name)
                    : SLOT_LABEL[slot]}
                </span>
              </button>
            ))}
          </div>
          <div className="totals">
            <div>
              <div className="n">{formatSigned(hero.gear.attack)}</div>
              <div className="k">ATTACK</div>
            </div>
            <div>
              <div className="n">{formatSigned(hero.gear.strength)}</div>
              <div className="k">STRENGTH</div>
            </div>
            <div>
              <div className="n">{formatSigned(hero.gear.defence)}</div>
              <div className="k">DEFENCE</div>
            </div>
            <div title={boost.lines.join(' · ') || 'nothing worn boosts xp'}>
              <div className={boost.totalPercent > 0 ? 'n accent' : 'n'}>
                {formatSigned(boost.totalPercent, '%')}
              </div>
              <div className="k">XP BOOST</div>
            </div>
          </div>
        </div>

        <div className="card">
          <Label>Toolbelt</Label>
          <span className="belt-sub">one tool per skill, always with you</span>
          <div className="belt">
            {tools.map(({ slot, item }) => (
              <button
                key={slot}
                className={sel === slot ? 'belt-row on' : 'belt-row'}
                onClick={() => pick(slot)}
              >
                <TileBox size="md" dim={item === null}>
                  {item ? (
                    <BareIcon spec={itemIconSpec(content, item)} size={19} />
                  ) : (
                    <UiIcon id={TOOL_ICON[slot]} size={18} />
                  )}
                </TileBox>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className={item ? 'name' : 'name none'}>
                    {item ? item.name : `No ${SLOT_LABEL[slot].toLowerCase()}`}
                  </div>
                  <div className="sub">
                    {content.skill(TOOL_SLOTS[slot]).name} ·{' '}
                    {item
                      ? `${formatSigned(-toolCutPercent(sim, slot, content), '%')} action time`
                      : 'bare hands'}
                  </div>
                </div>
                {item?.material && (
                  <span className="tier">{content.material(item.material).name}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Selected
          slot={sel}
          item={selItem}
          sim={sim}
          open={open}
          onClose={() => setOpen(false)}
          onUnequip={() => dispatch({ type: 'unequip', slot: sel })}
          onEquip={(item) => dispatch({ type: 'equip', item })}
        />
      </div>
    </>
  );
}

function Selected({
  slot,
  item,
  sim,
  open,
  onClose,
  onUnequip,
  onEquip,
}: {
  slot: EquipmentSlot;
  item: ItemDef | null;
  sim: ScreenProps['sim'];
  /** Raised as a sheet on a phone; ignored on a wide screen. */
  open: boolean;
  onClose: () => void;
  onUnequip: () => void;
  onEquip: (item: string) => void;
}) {
  const tool = slot in TOOL_SLOTS;
  const label = SLOT_LABEL[slot];
  const inBank = bankItemsFor(sim, content, slot);
  return (
    <div className={open ? 'card sheet' : 'card'}>
      <div className="sheet-head">
        <Label>Selected</Label>
        {open && (
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      <div className="sel-head">
        <TileBox size="xl" dim={item === null}>
          {item ? (
            <BareIcon spec={itemIconSpec(content, item)} size={26} />
          ) : (
            <UiIcon id="lorc/padlock" size={14} />
          )}
        </TileBox>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{item ? item.name : `${label} — empty`}</div>
          <div className="sub">
            {tool ? `toolbelt · ${label.toLowerCase()}` : `worn · ${label.toLowerCase()}`}
          </div>
        </div>
      </div>
      <div className="stat-block" style={{ marginTop: 14 }}>
        {item ? (
          Object.entries(item.stats).map(([k, v]) => (
            <div className="stat-row" key={k}>
              <span className="k">{STAT_LABEL[k] ?? k}</span>
              <span className={k === 'gather' ? 'v accent' : 'v'}>
                {k === 'gather'
                  ? formatSigned(-v, '% time')
                  : k === 'speed'
                    ? formatSigned(v, ' ticks')
                    : formatSigned(v)}
              </span>
            </div>
          ))
        ) : (
          <div className="stat-row">
            <span className="k">status</span>
            <span className="v" style={{ color: 'var(--fg-3)' }}>
              unequipped
            </span>
          </div>
        )}
        {item && xpBoostText(item, content) && (
          <div className="stat-row">
            <span className="k">xp boost</span>
            <span className="v accent">{xpBoostText(item, content)}</span>
          </div>
        )}
        {item && slot === 'ammo' && (
          <div className="stat-row">
            <span className="k">in the bank</span>
            <span className="v">{formatInt(ammoView(sim, content)?.inBank ?? 0)} more</span>
          </div>
        )}
        {item && (
          <div className="stat-row">
            <span className="k">tier</span>
            <span className="v">{item.material ? content.material(item.material).name : '—'}</span>
          </div>
        )}
      </div>
      <div className="sel-flavour">
        {item
          ? item.description || 'It says nothing.'
          : `The hill notices your bare ${label.toLowerCase()}. It says nothing.`}
      </div>
      {item ? (
        <button
          className="btn unequip"
          style={{ marginTop: 14, width: '100%' }}
          onClick={onUnequip}
        >
          Unequip → bank
        </button>
      ) : (
        <div className="empty-note">nothing equipped here</div>
      )}
      {inBank.length > 0 && (
        <div className="equip-list">
          <Label>In the bank</Label>
          {inBank.map((b) => (
            <button key={b.id} className="equip-opt" onClick={() => onEquip(b.id)}>
              <TileBox size="sm">
                <BareIcon spec={itemIconSpec(content, b)} size={18} />
              </TileBox>
              <span className="name">{b.name}</span>
              <span className="sub">{statLine(b)}</span>
              <span className="btn fight">Equip</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function statLine(item: ItemDef): string {
  const boost = xpBoostText(item, content);
  return [
    ...Object.entries(item.stats)
      .filter(([k]) => k !== 'heal')
      .map(
        ([k, v]) =>
          `${k === 'gather' ? '−' + String(v) + '%' : formatSigned(v)} ${STAT_LABEL[k] ?? k}`,
      ),
    ...(boost ? [boost] : []),
  ].join(' · ');
}

function lastWord(name: string): string {
  return name.split(' ').slice(-1)[0] ?? name;
}
