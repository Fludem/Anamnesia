/**
 * What the "?" says on each skill screen: what the skill is, how a cycle actually resolves,
 * how best to climb it, and where it sits in the chain. Copy only — every number the panel
 * shows is read from the save by `derive-help.ts`, so nothing here can go stale except the
 * prose. "fight" is the combat screen's topic and covers both styles; "sorcery" is the bench.
 */
import { FIGHT } from '../derive-help.ts';

export interface HelpCopy {
  /** One dry line under the title. */
  lead: string;
  /** How the cycle resolves, in the skill's own nouns. */
  works: readonly string[];
  /** How best to climb it, in order. */
  climb: readonly string[];
  /** What feeds it and what it feeds. */
  chain: string;
}

/** The lines every gathering skill shares; `noun` is a vein, a tree, a water, a patch. */
function gatherWorks(noun: string, tool: string | null): string[] {
  return [
    `A ${noun} has a level, a time and a chance. Below its level you cannot start it; every level above adds a point to the chance.`,
    `A cycle that lands rolls each of the ${noun}'s tables into the bank and pays its xp. One that misses costs the time and nothing else.`,
    tool === null
      ? 'This one is done by hand: no tool shortens it, and nothing you wear changes what comes up.'
      : `The ${tool} cuts the cycle's time and does nothing else. It never changes what comes out.`,
    'One action at a time on the hill. Starting here stops whatever else was running.',
    'A full bank stops the work before the drop, not after — so nothing is ever lost to a missing slot.',
  ];
}

const NIGHT =
  'The hill counts four hours away without lamps. The trader sells longer nights; a hall’s Watchtower adds more.';
const QUICK =
  'A quick method pays more xp an hour and banks nothing worth keeping. Take it when xp is what you want and the haul is not.';
const HIGHEST = (noun: string) =>
  `Work the highest ${noun} you can hold. The chance climbs a point a level, so one that misses half the time now will not in ten.`;

export const HELP: Readonly<Record<string, HelpCopy>> = {
  mining: {
    lead: 'Ore out of the hill, one swing at a time. The pickaxe only makes it quicker.',
    works: gatherWorks('vein', 'pickaxe'),
    climb: [
      HIGHEST('vein'),
      QUICK,
      'Swear to Tharok if mining is the plan: a tenth more xp here and at the anvil after it.',
      NIGHT,
    ],
    chain: 'Ore goes to the anvil, and the anvil makes everything worn — the pickaxe included.',
  },
  woodcutting: {
    lead: 'Logs, by the axe. What burns, and what a staff is cut from.',
    works: gatherWorks('grove', 'axe'),
    climb: [
      HIGHEST('grove'),
      QUICK,
      'Vessith swears over the woods: a tenth more xp and a second table of seeds on every cycle.',
      NIGHT,
    ],
    chain:
      'Logs feed the fire, and the fire leaves the ash every mark is pressed with. Wood also shafts the rods and the staffs.',
  },
  fishing: {
    lead: 'Raw fish out of cold water. The rod only makes it quicker.',
    works: gatherWorks('water', 'rod'),
    climb: [
      HIGHEST('water'),
      QUICK,
      'Maren doubles a twentieth of the catch outright, on top of a tenth more xp.',
      NIGHT,
    ],
    chain: 'Raw fish is not food until it is cooked, and cooked fish is what a fight runs on.',
  },
  foraging: {
    lead: 'Herbs, resin and incense, by hand. What the gods will take.',
    works: gatherWorks('patch', null),
    climb: [
      HIGHEST('patch'),
      QUICK,
      'No god favours foraging, so the oath is worth nothing here — swear for the fight instead.',
      NIGHT,
    ],
    chain:
      'What you gather burns as an offering: favour, and the god’s boon for as long as it lasts.',
  },
  firemaking: {
    lead: 'Logs go on. Ash comes off. Nothing here fails.',
    works: [
      'A fire takes one log, pays its xp and leaves ash. Firemaking has no failure roll.',
      'The logs are taken when the cycle finishes, not when it starts, so stopping early costs nothing.',
      'A fire burns until the logs run out, then stops itself and says so.',
      'One action at a time on the hill. Starting here stops whatever else was running.',
    ],
    climb: [
      'Burn the hottest log you have the level for: the xp per log climbs far faster than the time it takes.',
      'Cut ahead. Firemaking is only ever as fast as the woodcutting behind it.',
      'Ashkar pays a tenth more here and at the pot after it.',
      'Ash is no longer waste — every mark a staff casts is pressed with it. Keep it.',
    ],
    chain:
      'Woodcutting feeds it; it gates the cooking (a hotter fish wants a hotter fire) and stocks the sorcery bench.',
  },
  cooking: {
    lead: 'Fish over the fire. Some of it will burn; that is also cooking.',
    works: [
      'A dish takes one raw fish and rolls against your level. A success is food; a failure is a charred fish and no xp.',
      'The chance climbs two points a level, so a dish that burns four in ten now will not in twenty.',
      'Every dish above the first wants a firemaking level as well as a cooking one; the row says which.',
      'The fish are taken when the cycle finishes, so stopping early costs nothing.',
    ],
    climb: [
      'The newest dish pays most, even counting what burns. Move up as soon as the level opens.',
      'The quick fish — sprat, bleak, smelt, char — cook faster and burn less: more xp an hour, less food a fish.',
      'Ashkar pays a tenth more here and at the fire before it.',
      'Cook what you mean to eat. Food is the only thing standing between a long fight and the ferryman.',
    ],
    chain: 'Fishing feeds it; the zones eat it.',
  },
  smithing: {
    lead: 'Ore to bar, bar to everything worn.',
    works: [
      'A recipe takes its inputs from the bank when the cycle finishes and pays its xp. Nothing at the anvil fails.',
      'Bars first: every tool, weapon and plate is bars, and the ladder runs copper to aether.',
      'A recipe can want a level in another skill as well as its own; the row says which.',
      'The work runs until the inputs run out, then stops itself and says so.',
    ],
    climb: [
      'Smelt in bulk, then make. Bars are the whole skill’s throughput.',
      'The newest bar pays the most xp an hour — but only while there is ore for it. Mine ahead.',
      'Tharok pays a tenth more here and in the rock before it.',
      'Making gear is worth more than the xp: a better pickaxe is more ore, which is more bars.',
    ],
    chain: 'Mining feeds it. It arms the fight, fills the toolbelt and shods the staffs.',
  },
  sorcery: {
    lead: 'Marks pressed from ore and ash, staffs shod with a bar — and then the other way to fight.',
    works: [
      'A mark is the tier’s ore pressed with one or two ash, twenty to a cycle. A staff is the tier’s log with its bar.',
      'Nothing at the bench fails. Inputs go when the cycle finishes; the work stops itself when the ash runs out.',
      'In the zones a staff casts on this level and pays this skill, burning one mark from the ammo slot per landed cast.',
      'A staff with no marks of its own is a stick: the fight will not start, and ends itself when the last mark goes.',
    ],
    climb: [
      'Sorcery climbs twice — at the bench and in the zones. Whichever is faster for you today is the right one.',
      'Ash is the bottleneck, not ore. Burn logs ahead of a night of inscribing.',
      'Press marks in bulk before a night of casting: a fight burns seven hundred to twelve hundred an hour.',
      'Every monster is weak to one style. A staff hits a quarter harder on what is stone, shade or dead.',
    ],
    chain:
      'Ash from the fire and ore from the hill make the marks; wood and the anvil make the staff.',
  },
  [FIGHT]: {
    lead: 'One level does attack, strength and defence. The worn weapon decides which level that is.',
    works: [
      'A swing lands on your attack against the monster’s defence — never certain, never impossible. A hit that lands is 1 up to your max hit.',
      'Xp is paid per point of damage, so a kill pays exactly the monster’s xp however it is spread. Hitpoints takes a third on top and is never trained directly.',
      'Every monster is weak to melee or to sorcery. Your style against its weakness hits a quarter harder: the fight is shorter, not surer.',
      'A sword swings on Combat; a staff casts on Sorcery and burns a mark a cast. Nothing in hand is melee.',
      'Gear asks for a level before it goes on: a weapon and its ammo in the fight they belong to, armour and jewellery in whichever fight you are better at. What is already worn stays worn.',
      'Food is eaten from the bank on its own below the share you set. Favour burns one a second and runs the god’s boon while it lasts.',
      'Death takes one worn body item at random — never a tool — unless an obol in the bank or the ferryman’s fee settles the crossing.',
    ],
    climb: [
      'Fight what you are strong against: the zone list marks the style each monster is weak to.',
      'Cook before you fight. A fight without food ends at the first monster that hits harder than you heal.',
      'Better gear beats a better zone. Attack decides how often you land, strength how hard, defence how long you last.',
      'A tier of gear opens at 10, 25, 45, 60 and 75, in either fight for the armour. Smith it early and it waits in the bank for the level.',
      'The fastest kill is not always the one you survive — read the seconds and its max hit together.',
      'Keep an obol in the bank, or the ferryman on. Losing a plate costs more than the fee.',
    ],
    chain:
      'The anvil and the bench arm it, cooking feeds it, foraging keeps the god’s hand in it — and what falls here is what a hall is raised from.',
  },
};
