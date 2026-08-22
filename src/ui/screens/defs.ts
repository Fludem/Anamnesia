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
  /** The tool that shortens the action, or null for a skill done by hand. */
  toolSlot: ToolSlot | null;
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
  fishing: {
    skill: 'fishing',
    toolSlot: 'rod',
    noun: 'Waters',
    unlockVerb: 'New water found',
    nodes: content.waters,
    request: (water) => ({ kind: 'fishing', water, count: null }),
  },
  foraging: {
    skill: 'foraging',
    toolSlot: null,
    noun: 'Patches',
    unlockVerb: 'New patch found',
    nodes: content.patches,
    request: (patch) => ({ kind: 'foraging', patch, count: null }),
  },
};

export interface CraftSkillDef {
  skill: string;
  /** "RECIPES" / "FIRES" / "FISH" — the list's heading. */
  noun: string;
  idleHint: string;
  /** Whether the list shows category tabs (smithing has six; a fire is a fire). */
  tabs: boolean;
}

export const CRAFT_SKILLS: Readonly<Record<string, CraftSkillDef>> = {
  smithing: {
    skill: 'smithing',
    noun: 'Recipes',
    idleHint: 'Pick a recipe below. It runs until the inputs run out.',
    tabs: true,
  },
  firemaking: {
    skill: 'firemaking',
    noun: 'Fires',
    idleHint: 'Pick a fire below. It burns until the logs run out.',
    tabs: false,
  },
  cooking: {
    skill: 'cooking',
    noun: 'Dishes',
    idleHint: 'Pick a dish below. Some of it will burn; that is also cooking.',
    tabs: false,
  },
};

/** Outline shown in an empty tool slot. */
export const TOOL_ICON: Record<ToolSlot, string> = {
  pickaxe: 'lorc/mining',
  axe: 'lorc/wood-axe',
  rod: 'delapouite/fishing-pole',
};

export interface ScreenProps {
  sim: SimState;
  dispatch: (cmd: Command) => void;
  juice: Juice;
}
