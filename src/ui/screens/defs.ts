/** Screen definitions and shared prop types (data, no components). */
import { content } from '../../content/index.ts';
import type { ActionRequest } from '../../sim/actions.ts';
import type { Command } from '../../sim/commands.ts';
import type { GatherNodeDef } from '../../sim/content/schema.ts';
import type { SimState } from '../../sim/save.ts';
import type { ToolSlot } from '../../sim/slots.ts';
import { nodeRequest } from '../derive.ts';
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
  /** The skill keeps a slab: what it lands is weighed and the biggest of each kind is kept. */
  slab?: boolean;
}

export const GATHER_SKILLS: Readonly<Record<string, GatherSkillDef>> = {
  mining: {
    skill: 'mining',
    toolSlot: 'pickaxe',
    noun: 'Veins',
    unlockVerb: 'New vein surveyed',
    nodes: content.rocks,
    request: (id) => nodeRequest('mining', id),
  },
  woodcutting: {
    skill: 'woodcutting',
    toolSlot: 'axe',
    noun: 'Trees',
    unlockVerb: 'New grove surveyed',
    nodes: content.trees,
    request: (id) => nodeRequest('woodcutting', id),
  },
  fishing: {
    skill: 'fishing',
    toolSlot: 'rod',
    noun: 'Waters',
    unlockVerb: 'New water found',
    nodes: content.waters,
    request: (id) => nodeRequest('fishing', id),
    slab: true,
  },
  foraging: {
    skill: 'foraging',
    toolSlot: null,
    noun: 'Patches',
    unlockVerb: 'New patch found',
    nodes: content.patches,
    request: (id) => nodeRequest('foraging', id),
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
  sorcery: {
    skill: 'sorcery',
    noun: 'Inscriptions',
    idleHint:
      'Pick a mark below; it runs until the ash runs out. A staff with marks casts on the combat screen.',
    tabs: true,
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
