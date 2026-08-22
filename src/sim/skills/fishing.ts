import { gatheringHandler } from './gathering.ts';

export const FISHING = 'fishing';

/** Fishing: gathering over waters, with the rod as its tool. */
export const fishingHandler = gatheringHandler<'fishing'>({
  skill: FISHING,
  skillName: 'Fishing',
  toolSlot: 'rod',
  nodeKind: 'water',
  nodeId: (req) => req.water,
  hasNode: (ctx, id) => ctx.content.hasWater(id),
  node: (ctx, id) => ctx.content.water(id),
});
