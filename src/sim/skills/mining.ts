import { gatheringHandler } from './gathering.ts';

export const MINING = 'mining';

/** Mining: the reference gathering skill. See `gathering.ts` for the shared handler. */
export const miningHandler = gatheringHandler<'mining'>({
  skill: MINING,
  skillName: 'Mining',
  toolSlot: 'pickaxe',
  nodeKind: 'rock',
  nodeId: (req) => req.rock,
  hasNode: (ctx, id) => ctx.content.hasRock(id),
  node: (ctx, id) => ctx.content.rock(id),
});
