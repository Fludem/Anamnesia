import { gatheringHandler } from './gathering.ts';

export const FORAGING = 'foraging';

/** Foraging: gathering over patches, by hand. What it finds is burnt for the sworn god. */
export const foragingHandler = gatheringHandler<'foraging'>({
  skill: FORAGING,
  skillName: 'Foraging',
  toolSlot: null,
  nodeKind: 'patch',
  nodeId: (req) => req.patch,
  hasNode: (ctx, id) => ctx.content.hasPatch(id),
  node: (ctx, id) => ctx.content.patch(id),
});
