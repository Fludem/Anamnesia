import { weighCatch } from '../records.ts';
import { gatheringHandler } from './gathering.ts';

export const FISHING = 'fishing';

/** Fishing: gathering over waters, with the rod as its tool and the slab to be weighed on. */
export const fishingHandler = gatheringHandler<'fishing'>({
  skill: FISHING,
  skillName: 'Fishing',
  toolSlot: 'rod',
  nodeKind: 'water',
  nodeId: (req) => req.water,
  hasNode: (ctx, id) => ctx.content.hasWater(id),
  node: (ctx, id) => ctx.content.water(id),
  weigh: (state, landed, node, ctx) => weighCatch(state, landed, node, FISHING, ctx),
});
