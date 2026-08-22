/**
 * Combat has content (zones, monsters) but no loop yet. This screen says so plainly and shows
 * the survey of the hill, so the roster is visible and the navigation has no dead end.
 */
import { content, simContext } from '../../content/index.ts';
import { skillView } from '../derive.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { monsterIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';

export function CombatScreen({ sim }: ScreenProps) {
  const skill = content.skill('combat');
  const sv = skillView(sim, 'combat', simContext);
  return (
    <>
      <ScreenHead icon={skill.icon} title={skill.name} level={sv} />
      <div className="columns">
        <div className="col-main">
          <div className="card">
            <div className="active-head">
              <TileBox size="xl" dim>
                <UiIcon id={skill.icon} size={30} />
              </TileBox>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="title">The slope is quiet</div>
                <div className="sub">
                  <span className="idle-hint">
                    Fighting arrives with the next phase. The ground has been surveyed.
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="card list">
            <div className="card-head">
              <Label>Ground</Label>
              <span className="spacer" />
              <span className="hint">{String(content.zones.length)} zones</span>
            </div>
            {content.zones.map((zone) => {
              const monsters = content.monstersIn(zone.id);
              const locked = sv.level < zone.level;
              return (
                <div
                  key={zone.id}
                  className={`row zone-row${locked ? ' locked' : ''}`}
                  style={{ cursor: 'default' }}
                >
                  <TileBox size="md" dim={locked}>
                    <UiIcon id={zone.icon} size={24} />
                  </TileBox>
                  <div className="body">
                    <div className="name">{zone.name}</div>
                    <div className="sub">
                      <span className="lv">Lv {String(zone.level)}</span> ·{' '}
                      {String(monsters.length)} foes · {zone.description}
                    </div>
                  </div>
                  {locked ? (
                    <span className="lock">
                      <UiIcon id="lorc/padlock" size={12} />
                      Lv {String(zone.level)}
                    </span>
                  ) : (
                    <span style={{ display: 'flex', gap: 4 }}>
                      {monsters.slice(0, 5).map((m) => (
                        <TileBox key={m.id} size="sm">
                          <BareIcon spec={monsterIconSpec(content, m)} size={20} title={m.name} />
                        </TileBox>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
