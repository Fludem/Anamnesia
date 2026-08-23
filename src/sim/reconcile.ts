/**
 * Content changes never need a save migration — unless an id is removed. Migrations only know
 * the save's shape, so this runs after them with the content in hand and drops whatever the
 * content no longer has: an action on a vein that was renamed, a stack of an item that went,
 * a worn thing that no longer exists. Everything else is kept. The sim and every screen may
 * then assume every id in the state resolves.
 */
import type { ActionRequest } from './actions.ts';
import type { ContentDb } from './content/db.ts';
import type { Container } from './items.ts';
import type { SimEvent } from './events.ts';
import type { SimState } from './save.ts';
import { EQUIPMENT_SLOTS } from './slots.ts';

export interface Reconciled {
  sim: SimState;
  /** What was dropped, one line each, for the log. Empty when the save was clean. */
  dropped: string[];
}

export function requestKnown(req: ActionRequest, content: ContentDb): boolean {
  switch (req.kind) {
    case 'mining':
      return content.hasRock(req.rock);
    case 'woodcutting':
      return content.hasTree(req.tree);
    case 'fishing':
      return content.hasWater(req.water);
    case 'foraging':
      return content.hasPatch(req.patch);
    case 'crafting':
      return content.hasRecipe(req.recipe);
    case 'combat':
      return content.hasMonster(req.monster);
  }
}

function requestTarget(req: ActionRequest): string {
  switch (req.kind) {
    case 'mining':
      return req.rock;
    case 'woodcutting':
      return req.tree;
    case 'fishing':
      return req.water;
    case 'foraging':
      return req.patch;
    case 'crafting':
      return req.recipe;
    case 'combat':
      return req.monster;
  }
}

function eventKnown(e: SimEvent, content: ContentDb): boolean {
  const items = (stacks: readonly { item: string }[]) =>
    stacks.every((s) => content.hasItem(s.item));
  switch (e.type) {
    case 'gain':
    case 'found':
      return content.hasSkill(e.skill) && items(e.items);
    case 'level':
    case 'stopped':
      return content.hasSkill(e.skill);
    case 'opened':
      return content.hasItem(e.item) && items(e.items);
    case 'kill':
      return content.hasMonster(e.monster) && items(e.items);
    case 'died':
      return (
        content.hasMonster(e.monster) &&
        (e.lost === null || content.hasItem(e.lost)) &&
        (e.kept === null || content.hasItem(e.kept))
      );
    case 'offered':
      return content.hasItem(e.item);
    case 'gave':
      return content.hasRoom(e.room) && (e.item === null || content.hasItem(e.item));
    case 'raised':
      return content.hasRoom(e.room);
    case 'tutorial':
      return true;
  }
}

export function reconcileWithContent(sim: SimState, content: ContentDb): Reconciled {
  const dropped: string[] = [];
  const keepStacks = (where: string, c: Container): Container =>
    c.filter((s) => {
      if (content.hasItem(s.item)) return true;
      dropped.push(`${where}: ${String(s.qty)} × unknown item "${s.item}"`);
      return false;
    });
  const knownItem = (where: string, id: string | null): string | null => {
    if (id === null || content.hasItem(id)) return id;
    dropped.push(`${where}: unknown item "${id}"`);
    return null;
  };

  let current = sim.action.current;
  if (current !== null && !requestKnown(current.request, content)) {
    dropped.push(
      `action: unknown ${current.request.kind} target "${requestTarget(current.request)}"`,
    );
    current = null;
  }
  const queue = sim.action.queue.filter((req) => {
    if (requestKnown(req, content)) return true;
    dropped.push(`queue: unknown ${req.kind} target "${requestTarget(req)}"`);
    return false;
  });

  const equipment = { ...sim.equipment };
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = knownItem(`worn ${slot}`, equipment[slot]);

  const skills = Object.fromEntries(
    Object.entries(sim.skills).filter(([id]) => {
      if (content.hasSkill(id)) return true;
      dropped.push(`skills: unknown skill "${id}"`);
      return false;
    }),
  );

  let fight = sim.combat.fight;
  if (fight !== null && !content.hasMonster(fight.monster)) {
    dropped.push(`fight: unknown monster "${fight.monster}"`);
    fight = null;
  }

  const log = sim.log.filter((e) => eventKnown(e, content));
  if (log.length !== sim.log.length) {
    dropped.push(`log: ${String(sim.log.length - log.length)} entries naming things that are gone`);
  }

  const inventory = keepStacks('inventory', sim.inventory);
  const bank = keepStacks('bank', sim.bank);
  const food = knownItem('food', sim.combat.food);
  const offering = knownItem('offering', sim.combat.offering);
  const upgrades = Object.fromEntries(
    Object.entries(sim.upgrades).filter(([id]) => {
      if (content.hasWare(id)) return true;
      dropped.push(`upgrades: unknown ware "${id}"`);
      return false;
    }),
  );
  // A gift for a room that is gone stays on the cart: the register answers it with nothing
  // taken and the items come back. A gift of an item that is gone has nothing to come back.
  const rooms = Object.fromEntries(
    Object.entries(sim.hall.rooms).filter(([id]) => {
      if (content.hasRoom(id)) return true;
      dropped.push(`hall: unknown room "${id}"`);
      return false;
    }),
  );
  const gifts = sim.hall.gifts.filter((g) => {
    if (g.item === null || content.hasItem(g.item)) return true;
    dropped.push(`hall: gift of ${String(g.qty)} × unknown item "${g.item}"`);
    return false;
  });

  if (dropped.length === 0) return { sim, dropped };
  return {
    sim: {
      ...sim,
      skills,
      inventory,
      bank,
      equipment,
      action: { current, queue },
      log,
      upgrades,
      hall: { ...sim.hall, rooms, gifts },
      combat: { ...sim.combat, food, offering, fight },
    },
    dropped,
  };
}
