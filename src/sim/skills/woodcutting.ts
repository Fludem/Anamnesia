import { gatheringHandler } from './gathering.ts';

export const WOODCUTTING = 'woodcutting';

/** Woodcutting: mining with trees. Same handler, different content list and tool slot. */
export const woodcuttingHandler = gatheringHandler<'woodcutting'>({
  skill: WOODCUTTING,
  skillName: 'Woodcutting',
  toolSlot: 'axe',
  nodeKind: 'tree',
  nodeId: (req) => req.tree,
  hasNode: (ctx, id) => ctx.content.hasTree(id),
  node: (ctx, id) => ctx.content.tree(id),
});
