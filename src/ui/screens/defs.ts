/** Screen definitions and shared prop types (data, no components). */
import { content } from '../../content/index.ts';
import type { ActionRequest } from '../../sim/actions.ts';
import type { Command } from '../../sim/commands.ts';
import type { GatherNodeDef } from '../../sim/content/schema.ts';
import type { SimState } from '../../sim/save.ts';
import type { ToolSlot } from '../../sim/slots.ts';
import type { Juice } from '../theme/theme.ts';

export interface GatherSkillDef {
  skill: string;
  toolSlot: ToolSlot;
  /** "VEINS" / "TREES" — the list's heading. */
  noun: string;
  /** Level-up copy: "New vein surveyed: …". */
  unlockVerb: string;
  nodes: readonly GatherNodeDef[];
  request: (nodeId: string) => ActionRequest;
}

export const GATHER_SKILLS: Readonly<Record<string, GatherSkillDef>> = {
  mining: {
    skill: 'mining',
    toolSlot: 'pickaxe',
    noun: 'Veins',
    unlockVerb: 'New vein surveyed',
    nodes: content.rocks,
    request: (rock) => ({ kind: 'mining', rock, count: null }),
  },
  woodcutting: {
    skill: 'woodcutting',
    toolSlot: 'axe',
    noun: 'Trees',
    unlockVerb: 'New grove surveyed',
    nodes: content.trees,
    request: (tree) => ({ kind: 'woodcutting', tree, count: null }),
  },
};

/** Outline shown in an empty tool slot. */
export const TOOL_ICON: Record<ToolSlot, string> = { pickaxe: 'lorc/mining', axe: 'lorc/wood-axe' };

export interface ScreenProps {
  sim: SimState;
  dispatch: (cmd: Command) => void;
  juice: Juice;
}
