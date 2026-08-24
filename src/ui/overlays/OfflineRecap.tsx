/** "WELCOME BACK" — Screen A's offline recap, with an honest line when the catch-up was capped. */
import { content, simContext } from '../../content/index.ts';
import type { OfflineRecap as RecapInfo } from '../../runtime/game-host.ts';
import type { SimState } from '../../sim/save.ts';
import { eventsOfType } from '../../sim/events.ts';
import { totalKills } from '../derive-combat.ts';
import { numeral } from '../derive-hall.ts';
import { recap } from '../derive.ts';
import { formatDuration, formatGrams, formatInt } from '../format.ts';
import { ItemIconTile, Label, RarityTag, SkillIcon, UiIcon } from '../parts.tsx';
import { TROPHY_ICON } from '../screens/Slab.tsx';
import { HALL_ICON } from '../Shell.tsx';
import type { Juice } from '../theme/theme.ts';
import { Modal } from './Modal.tsx';

const VERB: Record<string, string> = {
  mining: 'mined',
  woodcutting: 'cut',
  fishing: 'fished',
  foraging: 'foraged',
  firemaking: 'burned',
  cooking: 'cooked',
  smithing: 'smithed',
  sorcery: 'inscribed',
  combat: 'fought',
};

export function OfflineRecap({
  info,
  sim,
  juice,
  onCollect,
}: {
  info: RecapInfo;
  sim: SimState;
  juice: Juice;
  onCollect: () => void;
}) {
  const r = recap(info.before, sim, simContext);
  const kills = totalKills(sim) - totalKills(info.before);
  const deaths = sim.stats.deaths - info.before.stats.deaths;
  const offered = sim.stats.offered - info.before.stats.offered;
  const ambushes = sim.stats.ambushes - info.before.stats.ambushes;
  const routed = sim.stats.routed - info.before.stats.routed;
  const thrown = sim.stats.thrown - info.before.stats.thrown;
  const cast = sim.stats.cast - info.before.stats.cast;
  const quiverEmpty = thrown > 0 && sim.equipment.ammo === null;
  const marksOut = cast > 0 && sim.equipment.ammo === null;
  // What the hill left, as far as the log still remembers (the item list counts the rest).
  const found = eventsOfType(sim, 'found')
    .filter((f) => f.tick > info.before.tick)
    .flatMap((f) => f.items.map((i) => content.item(i.item).name));
  // The log is short; the items it still remembers are named, the rest is counted.
  const since = eventsOfType(sim, 'died').filter((d) => d.tick > info.before.tick);
  const taken = since.filter((d) => d.lost !== null).map((d) => content.item(d.lost!).name);
  const kept = since.filter((d) => d.kept !== null).map((d) => content.item(d.kept!).name);
  // Nothing else spends while away, so the coins spent are the ferryman's.
  const ferried = sim.stats.ferried - info.before.stats.ferried;
  const fee = sim.stats.spent - info.before.stats.spent;
  const obols = since.filter((d) => d.obol).length;
  // Trophies crossed while away, as far as the log still remembers.
  const trophies = eventsOfType(sim, 'trophy')
    .filter((t) => t.tick > info.before.tick && content.hasItem(t.item))
    .map((t) => content.item(t.item).name.replace(/^Raw /, ''));
  // Rooms the hall raised while away, as the register said on the way back in.
  const raised = eventsOfType(sim, 'raised')
    .filter((r) => r.tick > info.before.tick && content.hasRoom(r.room))
    .map((r) => `${content.room(r.room).name} stands at ${numeral(r.tier)}`);
  const top = r.skills[0];
  const verb = top ? (VERB[top.skill] ?? 'trained') : null;
  const capped = info.skippedTicks > 0;
  const uncounted = info.awayMs - info.capMs;
  return (
    <Modal tone="accent" wide dim>
      <Label className="accent">Welcome back</Label>
      <div className="lead">
        You were away for {formatDuration(info.awayMs)}
        {top ? ` — you ${verb ?? 'trained'}:` : '. Nothing was running.'}
      </div>
      {r.skills.map((s) => (
        <div key={s.skill} className="recap-main">
          <SkillIcon skill={s.skill} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="big">+{formatInt(s.xp)} xp</div>
            <div className="sub">
              {content.skill(s.skill).name} ·{' '}
              {s.skill === 'combat' || (s.skill === 'sorcery' && cast > 0)
                ? `${formatInt(kills)} kills`
                : s.skill === 'hitpoints'
                  ? 'from fighting'
                  : `${formatInt(s.actions)} actions`}
            </div>
          </div>
          {s.to > s.from && (
            <span className="tag-active" style={{ fontSize: 11, letterSpacing: 0 }}>
              Lv {String(s.from)} → {String(s.to)}
            </span>
          )}
        </div>
      ))}
      {r.items.length > 0 && (
        <>
          <div style={{ marginTop: 14 }}>
            <Label>Gathered</Label>
          </div>
          <div className="rows recap-scroll">
            {r.items.map((s) => {
              const item = content.item(s.item);
              return (
                <div key={s.item} className="recap-row">
                  <ItemIconTile item={item} size="sm" juice={juice} />
                  <span className="name">{item.name}</span>
                  <RarityTag rarity={item.rarity} />
                  <span className="n">×{formatInt(s.qty)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {r.records.length > 0 && (
        <div className="recap-note found">
          <UiIcon id={TROPHY_ICON} size={13} />
          the slab:{' '}
          {r.records
            .map((w) => `${content.item(w.item).name.replace(/^Raw /, '')} ${formatGrams(w.grams)}`)
            .join(', ')}
          {trophies.length > 0 ? ` · the trader paid for ${trophies.join(' and ')}` : ''}
        </div>
      )}
      {found.length > 0 && (
        <div className="recap-note found">
          <UiIcon id="delapouite/cape" size={13} />
          the hill left you {found.join(', ')}
        </div>
      )}
      {raised.length > 0 && (
        <div className="recap-note">
          <UiIcon id={HALL_ICON} size={13} />
          the hall was busy: {raised.join(', ')}
        </div>
      )}
      {thrown > 0 && (
        <div className="recap-note">
          <UiIcon id="lorc/thrown-spear" size={13} />
          {thrown === 1 ? 'one javelin thrown' : `${formatInt(thrown)} javelins thrown`}
          {quiverEmpty ? ' · the last one went with them' : ''}
        </div>
      )}
      {cast > 0 && (
        <div className="recap-note">
          <UiIcon id={content.skill('sorcery').icon} size={13} />
          {cast === 1 ? 'one mark cast' : `${formatInt(cast)} marks cast`}
          {marksOut ? ' · the last one went with them' : ''}
        </div>
      )}
      {ambushes + routed > 0 && (
        <div className="recap-note">
          <UiIcon id="lorc/crossed-swords" size={13} />
          the road tried you{' '}
          {ambushes + routed === 1 ? 'once' : `${formatInt(ambushes + routed)} times`}
          {ambushes > 0 ? ` · fought off ${formatInt(ambushes)}` : ''}
          {routed > 0 ? ` · driven off ${formatInt(routed)}` : ''}
        </div>
      )}
      {offered > 0 && (
        <div className="recap-note favour">
          <UiIcon id="lorc/incense" size={13} />
          {offered === 1 ? 'one offering burnt' : `${formatInt(offered)} offerings burnt`} · the
          boon held
          {sim.combat.favour === 0 ? ' until they ran out' : ''}
        </div>
      )}
      {deaths > 0 && (
        <div className="died" style={{ marginTop: 14 }}>
          <UiIcon id="lorc/skull-crossed-bones" size={14} />
          <span>
            {deaths === 1 ? 'you died once' : `you died ${String(deaths)} times`}
            {taken.length > 0 ? ` · the hill took ${taken.join(', ')}` : ''}
            {ferried > 0
              ? ` · the ferryman was paid ${String(ferried)} time${ferried === 1 ? '' : 's'}` +
                (fee > 0 ? ` (${formatInt(fee)} gp)` : '') +
                (obols > 0 ? ` (${String(obols)} obol${obols === 1 ? '' : 's'})` : '')
              : ''}
            {kept.length > 0 ? ` · kept ${kept.join(', ')}` : ''}
          </span>
        </div>
      )}
      {capped && (
        <div className="recap-note">
          Offline progress is capped at {formatDuration(info.capMs)}. The other{' '}
          {formatDuration(uncounted)} did not count.
        </div>
      )}
      <button
        className="btn primary"
        style={{ width: '100%', marginTop: 16, padding: '10px 0' }}
        onClick={onCollect}
      >
        Collect
      </button>
    </Modal>
  );
}
