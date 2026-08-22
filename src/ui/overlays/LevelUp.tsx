/** The level-up moment from Screen A: two expanding rings and a card that pops and fades. */
import { content } from '../../content/index.ts';
import type { SimEventOf } from '../../sim/events.ts';
import { unlockText } from '../unlocks.ts';
import { SkillIcon, Label } from '../parts.tsx';
import type { Juice } from '../theme/theme.ts';

export function LevelUp({ event, juice }: { event: SimEventOf<'level'>; juice: Juice }) {
  const skill = content.skill(event.skill);
  return (
    <div className={`levelup ${juice}`} aria-live="polite">
      {juice === 'juicy' && (
        <>
          <div className="ring" />
          <div className="ring slow" />
        </>
      )}
      <div className="levelup-card">
        <Label className="accent">LEVEL UP</Label>
        <div className="big">
          <SkillIcon skill={skill.id} size={26} />
          {skill.name} {String(event.to)}
        </div>
        <div className="unlock">{unlockText(skill.id, event.to)}</div>
      </div>
    </div>
  );
}
