/**
 * Screen E — combat. Screen A's skeleton with the fight where the action card was: the hero
 * and the monster side by side with hitpoints, swing timers and the numbers popping over the
 * bars; the food row under it; the zones with their monsters; the kill log on the right.
 */
import { useEffect, useRef, useState } from 'react';
import { content, simContext } from '../../content/index.ts';
import { heroStats } from '../../sim/combat.ts';
import type { CombatBoon, MonsterDef } from '../../sim/content/schema.ts';
import type { SimState, Splat } from '../../sim/save.ts';
import {
  ammoView,
  boonText,
  favourView,
  fightView,
  foodOptions,
  foodView,
  killLog,
  lastDeath,
  offeringOptions,
  recentOffering,
  recentRareKill,
  totalKills,
  zoneRows,
  type AmmoView,
  type FightView,
  type SideView,
} from '../derive-combat.ts';
import { activeView, skillView } from '../derive.ts';
import { formatAge, formatDuration, formatInt, formatSeconds, ticksToMs } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec, monsterIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { popX, useNow } from '../util.ts';
import type { Juice } from '../theme/theme.ts';
import { ScreenHead, XpRow } from './common.tsx';
import type { ScreenProps } from './defs.ts';

const EAT_AT_STEPS = [0.25, 0.5, 0.75];
const RARE_TOAST_TICKS = 26;
const DEATH_ICON = 'lorc/skull-crossed-bones';
const FAVOUR_ICON = 'lorc/incense';
const OFFER_FLASH_TICKS = 20;

export function CombatScreen({ sim, dispatch, juice }: ScreenProps) {
  const skill = content.skill('combat');
  const sv = skillView(sim, 'combat', simContext);
  const hp = skillView(sim, 'hitpoints', simContext);
  const fight = fightView(sim, simContext);
  const hero = heroStats(sim, simContext);
  return (
    <>
      <ScreenHead
        icon={skill.icon}
        title={skill.name}
        level={sv}
        chip={`HP ${String(hp.level)}`}
        skill="combat"
        sim={sim}
        rate={fight ? `${formatInt(fight.xpHr)} xp/hr` : null}
      />
      <XpRow view={sv} sim={sim} />
      <div className="columns">
        <div className="col-main">
          <FightCard
            sim={sim}
            fight={fight}
            juice={juice}
            maxHp={hero.maxHp}
            onStop={() => dispatch({ type: 'action:stop' })}
          />
          <FoodRow sim={sim} dispatch={dispatch} maxHp={hero.maxHp} />
          <FavourRow sim={sim} dispatch={dispatch} juice={juice} />
          <Zones sim={sim} dispatch={dispatch} />
        </div>
        <KillLog sim={sim} juice={juice} />
      </div>
    </>
  );
}

function FightCard({
  sim,
  fight,
  juice,
  maxHp,
  onStop,
}: {
  sim: SimState;
  fight: FightView | null;
  juice: Juice;
  maxHp: number;
  onStop: () => void;
}) {
  const death = lastDeath(sim);
  const [noted, setNoted] = useState<number | null>(null);
  const elsewhere = fight === null ? activeView(sim, simContext) : null;
  if (fight === null) {
    return (
      <div className="card">
        <div className="fight-idle">
          <TileBox size="md" dim>
            <UiIcon id={content.skill('combat').icon} size={20} />
          </TileBox>
          <span className="hint">
            {elsewhere
              ? `${content.skill(elsewhere.skill).name} is running (${elsewhere.name}). Fighting replaces it.`
              : `Not fighting. Pick a monster below. ${String(sim.combat.hp)} / ${String(maxHp)} hp.`}
          </span>
        </div>
        {death && noted !== death.tick && (
          <div className="died" role="status">
            <UiIcon id={DEATH_ICON} size={14} />
            <span>
              you died · {content.monster(death.monster).name} ·{' '}
              {death.lost === null
                ? 'the hill took nothing; you wore nothing'
                : `the hill took your ${content.item(death.lost).name}`}
            </span>
            <button
              className="btn sm"
              style={{ padding: '4px 9px' }}
              onClick={() => setNoted(death.tick)}
            >
              Noted
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="fight-sides">
        <Side
          view={fight.you}
          you
          juice={juice}
          boon={heroStats(sim, simContext).boon}
          ammo={ammoView(sim, content)}
        />
        <Side view={fight.them} monster={fight.monster} juice={juice} />
      </div>
      <div className="fight-foot">
        <span>
          kill {formatInt(totalKills(sim))} · {formatSeconds(fight.fightSeconds * 1000)} this fight
          · {formatInt(fight.xpPerKill)} xp per kill
        </span>
        <span className="spacer" />
        <button className="btn stop" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}

function Side({
  view,
  you,
  monster,
  juice,
  boon,
  ammo,
}: {
  view: SideView;
  you?: boolean;
  monster?: MonsterDef;
  juice: Juice;
  /** The hero's boon in effect, shown beside the name. */
  boon?: CombatBoon | null;
  /** What the hero throws, and how many are left. */
  ammo?: AmmoView | null;
}) {
  const frac = view.maxHp > 0 ? view.hp / view.maxHp : 0;
  return (
    <div className="fight-side">
      <div className="who">
        {you ? (
          <span className="avatar">{view.name.slice(0, 1).toUpperCase()}</span>
        ) : (
          <TileBox size="md">
            {monster && <BareIcon spec={monsterIconSpec(content, monster)} size={24} />}
          </TileBox>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="name">
            {view.name}
            {you && boon && (
              <span className="boon-tag" title={boonText(boon)}>
                {boon.name}
              </span>
            )}
            {you && ammo && (
              <span
                className={ammo.inBank === 0 ? 'ammo-tag last' : 'ammo-tag'}
                title={`${ammo.item.name}: one thrown with every swing that lands`}
              >
                {lastWord(ammo.item.name)} ×{formatInt(ammo.inBank + 1)}
              </span>
            )}
          </div>
          <div className="sub">{view.sub}</div>
        </div>
      </div>
      <div className="hp-wrap">
        <div className="hp-bar" role="progressbar" aria-valuenow={Math.round(frac * 100)}>
          <div
            className={you ? 'hp-fill' : 'hp-fill them'}
            style={{ width: `${(frac * 100).toFixed(1)}%` }}
          />
          <span className="hp-text">
            {String(view.hp)} / {String(view.maxHp)}
          </span>
        </div>
        {juice !== 'deadpan' && <Splats splats={view.splats} />}
      </div>
      <div className="stats">{view.statsLine}</div>
      <div className="swing-row">
        <div className="swing-bar">
          <div className="swing-fill" style={{ width: `${(view.swingFrac * 100).toFixed(1)}%` }} />
        </div>
        <span className="label">swings {formatSeconds(view.swingSeconds * 1000)}</span>
      </div>
    </div>
  );
}

function Splats({ splats }: { splats: Splat[] }) {
  return (
    <>
      {splats.map((p) => (
        <span
          key={`${String(p.tick)}:${p.kind}`}
          className={`splat ${p.kind}`}
          style={{ left: `${String(15 + (popX(p.tick) % 55))}%` }}
        >
          {p.kind === 'heal'
            ? `+${String(p.amount)}`
            : p.kind === 'hit'
              ? `−${String(p.amount)}`
              : '0'}
        </span>
      ))}
    </>
  );
}

function FoodRow({
  sim,
  dispatch,
  maxHp,
}: {
  sim: SimState;
  dispatch: ScreenProps['dispatch'];
  maxHp: number;
}) {
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
  const food = foodView(sim, content);
  const options = foodOptions(sim, content);
  const none = food.item === null || food.have === 0;
  const full = sim.combat.hp >= maxHp;
  const eatAt = sim.combat.eatAt;
  const nextEatAt = () => {
    const i = EAT_AT_STEPS.findIndex((s) => s > eatAt + 1e-9);
    dispatch({ type: 'combat:eat-at', fraction: EAT_AT_STEPS[i === -1 ? 0 : i]! });
  };
  return (
    <div className="card food-row" ref={ref}>
      <Label>Food</Label>
      <button className="food-pick" onClick={() => setOpen((o) => !o)} title="change food">
        <TileBox size="md" dim={none}>
          {food.item ? (
            <BareIcon spec={itemIconSpec(content, food.item)} size={20} />
          ) : (
            <UiIcon id="lorc/meat" size={18} />
          )}
        </TileBox>
        <div style={{ minWidth: 0 }}>
          <div className={none ? 'name none' : 'name'}>
            {food.item === null
              ? 'No food'
              : food.have === 0
                ? `No ${food.item.name} left`
                : food.item.name}
          </div>
          <div className="sub">
            {none
              ? 'no food · you will die at 0 hp'
              : `×${formatInt(food.have)} · heals ${String(food.heal)}`}
          </div>
        </div>
        <span className={open ? 'caret open' : 'caret'}>▾</span>
      </button>
      {open && (
        <div className="food-menu">
          <Label>From bank</Label>
          {options.length === 0 && (
            <div className="empty">Nothing in the bank heals. Cook something.</div>
          )}
          {options.map((o) => {
            const picked = o.item !== null && o.item.id === sim.combat.food;
            return (
              <button
                key={o.item!.id}
                className="food-opt"
                onClick={() => {
                  dispatch({ type: 'combat:food', item: o.item!.id });
                  setOpen(false);
                }}
              >
                <TileBox size="sm">
                  <BareIcon spec={itemIconSpec(content, o.item!)} size={17} />
                </TileBox>
                <div style={{ minWidth: 0 }}>
                  <div className="name">{o.item!.name}</div>
                  <div className="sub">
                    ×{formatInt(o.have)} in bank · heals {String(o.heal)}
                  </div>
                </div>
                {picked && <span className="tag-active">Equipped</span>}
              </button>
            );
          })}
        </div>
      )}
      <span className="spacer" />
      <button className="eat-at" onClick={nextEatAt} title="change the threshold">
        eat below <b>{String(Math.round(eatAt * 100))}%</b>
      </button>
      <button
        className="btn sm"
        style={{ padding: '6px 12px' }}
        disabled={none || full}
        onClick={() => dispatch({ type: 'combat:eat' })}
      >
        Eat
      </button>
    </div>
  );
}

/**
 * The god's row, the food row's twin: which offering burns when favour runs out, whether the
 * boon is lit, and how long the favour lasts. Hidden for a hero with no god (onboarding sees
 * to that) or a god with nothing to give in a fight.
 */
function FavourRow({
  sim,
  dispatch,
  juice,
}: {
  sim: SimState;
  dispatch: ScreenProps['dispatch'];
  juice: Juice;
}) {
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
  const fv = favourView(sim, simContext);
  if (fv.god === null || fv.boon === null) return null;
  const options = offeringOptions(sim, content);
  const none = fv.offering === null || fv.have === 0;
  const flash = juice !== 'deadpan' && recentOffering(sim, OFFER_FLASH_TICKS) !== null;
  const cls = `card food-row favour-row${fv.lit ? ' lit' : ''}${flash ? ' flash' : ''}`;
  return (
    <div className={cls} ref={ref}>
      <Label>Favour</Label>
      <button className="food-pick" onClick={() => setOpen((o) => !o)} title="change offering">
        <TileBox size="md" dim={none}>
          {fv.offering ? (
            <BareIcon spec={itemIconSpec(content, fv.offering)} size={20} />
          ) : (
            <UiIcon id={FAVOUR_ICON} size={18} />
          )}
        </TileBox>
        <div style={{ minWidth: 0 }}>
          <div className={none ? 'name none' : 'name'}>
            {fv.offering === null
              ? 'No offering'
              : fv.have === 0
                ? `No ${fv.offering.name} left`
                : fv.offering.name}
          </div>
          <div className="sub">
            {none
              ? 'nothing to burn · the boon sleeps when favour runs out'
              : `×${formatInt(fv.have)} · ${String(fv.each)} favour each`}
          </div>
        </div>
        <span className={open ? 'caret open' : 'caret'}>▾</span>
      </button>
      {open && (
        <div className="food-menu">
          <Label>From bank</Label>
          {options.length === 0 && (
            <div className="empty">Nothing in the bank burns for favour. Forage something.</div>
          )}
          {options.map((o) => {
            const picked = o.item.id === sim.combat.offering;
            return (
              <button
                key={o.item.id}
                className="food-opt"
                onClick={() => {
                  dispatch({ type: 'combat:offering', item: o.item.id });
                  setOpen(false);
                }}
              >
                <TileBox size="sm">
                  <BareIcon spec={itemIconSpec(content, o.item)} size={17} />
                </TileBox>
                <div style={{ minWidth: 0 }}>
                  <div className="name">{o.item.name}</div>
                  <div className="sub">
                    ×{formatInt(o.have)} in bank · {String(o.each)} favour
                  </div>
                </div>
                {picked && <span className="tag-active">Chosen</span>}
              </button>
            );
          })}
        </div>
      )}
      <span className="spacer" />
      <div className="boon-state" title={fv.boon.line}>
        <div className="boon-name">
          <UiIcon id={fv.god.icon} size={12} />
          {fv.boon.name}
          <span className={fv.lit ? 'boon-on' : 'boon-off'}>{fv.lit ? 'lit' : 'out'}</span>
        </div>
        <div className="sub">
          {boonText(fv.boon)}
          {fv.lit
            ? ` · ${formatInt(fv.favour)} favour · ${formatDuration(fv.seconds * 1000)} of fighting`
            : ' · no favour · burns one a second in a fight'}
        </div>
      </div>
      <button
        className="btn sm"
        style={{ padding: '6px 12px' }}
        disabled={none}
        onClick={() => dispatch({ type: 'combat:offer' })}
      >
        Offer
      </button>
    </div>
  );
}

function Zones({ sim, dispatch }: { sim: SimState; dispatch: ScreenProps['dispatch'] }) {
  const rows = zoneRows(sim, simContext);
  const [open, setOpen] = useState<string | null>(
    () => rows.find((z) => z.active)?.zone.id ?? rows.find((z) => !z.locked)?.zone.id ?? null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="card list">
      <div className="card-head">
        <Label>Zones</Label>
        <span className="spacer" />
        <span className="hint">{String(rows.length)} charted</span>
      </div>
      {rows.map((z) => {
        const isOpen = open === z.zone.id && !z.locked;
        return (
          <div key={z.zone.id}>
            <button
              className={`row zone-row${z.locked ? ' locked' : ''}${z.active ? ' active' : ''}`}
              disabled={z.locked}
              onClick={() => setOpen(isOpen ? null : z.zone.id)}
            >
              <TileBox size="md" dim={z.locked}>
                <UiIcon id={z.zone.icon} size={22} />
              </TileBox>
              <div className="body">
                <div className="name">{z.zone.name}</div>
                <div className="sub">
                  {z.locked ? `requires Lv ${String(z.zone.level)}` : `Lv ${String(z.zone.level)}`}{' '}
                  · {z.zone.description}
                </div>
              </div>
              {z.active && <span className="tag-active">Active</span>}
              {z.locked ? (
                <span className="lock">
                  <UiIcon id="lorc/padlock" size={12} />
                  Lv {String(z.zone.level)}
                </span>
              ) : (
                <span className={isOpen ? 'caret open' : 'caret'}>▾</span>
              )}
            </button>
            {isOpen &&
              z.monsters.map((m) => {
                const sel = picked === m.monster.id && !m.fighting;
                return (
                  <button
                    key={m.monster.id}
                    className={`mon-row${m.fighting ? ' fighting' : sel ? ' picked' : ''}`}
                    onClick={() => setPicked(sel ? null : m.monster.id)}
                    title={m.monster.description}
                  >
                    <TileBox size="sm">
                      <BareIcon spec={monsterIconSpec(content, m.monster)} size={18} />
                    </TileBox>
                    <span className="name">{m.monster.name}</span>
                    <span className="sub">
                      Lv {String(m.monster.level)} · hp {String(m.monster.hp)} · max hit{' '}
                      {String(m.maxHit)} · {formatInt(m.xp)} xp · ~
                      {formatSeconds(m.killSeconds * 1000)} a kill
                    </span>
                    <span className="spacer" />
                    {m.fighting && <span className="tag-active">Fighting</span>}
                    {sel && (
                      <span
                        className="btn fight"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicked(null);
                          dispatch({
                            type: 'action:start',
                            request: { kind: 'combat', monster: m.monster.id, count: null },
                          });
                        }}
                      >
                        Fight
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

function KillLog({ sim, juice }: { sim: SimState; juice: Juice }) {
  const rows = killLog(sim, content, 12);
  const kills = totalKills(sim);
  const toast = juice === 'juicy' ? recentRareKill(sim, content, RARE_TOAST_TICKS) : null;
  const kinds = Object.keys(sim.stats.kills).length;
  const session = useNow(1000) - SESSION_START;
  return (
    <div className="card feed col-side">
      <div className="card-head" style={{ padding: '8px 14px 6px' }}>
        <Label>Kill log</Label>
        <span className="spacer" />
        <span className="hint">{formatInt(kills)} kills</span>
      </div>
      {toast && (
        <div className={`toast ${toast.item.rarity}`}>
          <BareIcon spec={itemIconSpec(content, toast.item)} size={16} />
          <span className="kind">
            {toast.item.rarity === 'legendary' ? 'LEGENDARY' : 'RARE DROP'}
          </span>
          <span className="name">{toast.item.name}</span>
        </div>
      )}
      {rows.length === 0 && (
        <div className="feed-empty">Nothing yet. Kills land here as they happen.</div>
      )}
      {rows.map((r) => {
        const fresh = Math.max(0, 1 - ticksToMs(r.ageTicks) / 900);
        return (
          <div
            key={r.key}
            className="kill-row"
            style={{
              background:
                fresh > 0 ? `rgba(var(--accent-rgb), ${(fresh * 0.07).toFixed(3)})` : undefined,
            }}
          >
            <TileBox size="sm">
              <BareIcon spec={monsterIconSpec(content, r.monster)} size={18} />
            </TileBox>
            <div className="body">
              <div className="head">
                <span className="name">{r.monster.name}</span>
                <span className="xp">+{formatInt(r.xp)} xp</span>
                {r.rare && (
                  <span className={`rarity-tag ${r.rare.rarity}`}>
                    {r.rare.rarity.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="items">{r.items}</div>
            </div>
            <span className="age">{formatAge(ticksToMs(r.ageTicks))}</span>
          </div>
        );
      })}
      <div className="feed-foot">
        {formatInt(kills)} kills · {formatInt(kinds)} kinds · {formatDuration(session)} this session
      </div>
    </div>
  );
}

const SESSION_START = Date.now();

function lastWord(name: string): string {
  return name.split(' ').slice(-1)[0] ?? name;
}
