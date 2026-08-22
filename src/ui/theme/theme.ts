/**
 * Design tokens, extracted verbatim from the Claude Design screens in design/claude-design
 * (2026-08-22). `tokens.css` exposes the same values as CSS custom properties; the test in
 * theme.test.ts keeps the two in sync. Material palettes are NOT here — they are content
 * (src/content/materials.json) because an item's colour is data, not decoration.
 */

export const color = {
  /** Page background. */
  bg: '#141518',
  /** Sidebar, top bar, tab bar. */
  bgChrome: '#17181b',
  /** Cards and panels. */
  bgPanel: '#1b1d21',
  /** Cells, inputs, stat blocks — anything inset into a panel. */
  bgInset: '#101214',
  /** Progress-bar tracks. */
  bgTrack: '#0f1113',
  /** Row hover. */
  bgHover: '#1e2125',
  /** Popover menus. */
  bgMenu: '#1f2226',
  /** Menu item hover, avatar disc. */
  bgMenuHover: '#26292e',

  border: '#24272c',
  /** Cells, buttons, popovers. */
  borderStrong: '#2c2f35',
  /** Dividers between list rows. */
  borderRow: '#1f2226',
  /** Progress-bar track border. */
  borderTrack: '#26292c',

  fg: '#e8e6df',
  /** Slightly softer than fg (lock-level text). */
  fgSoft: '#d0cdc4',
  /** Secondary text, values. */
  fg2: '#a09d94',
  /** Inactive icons. */
  fgIcon: '#8b887f',
  /** Labels, hints, tertiary text. */
  fg3: '#67655e',
  /** Locked icons, disabled text. */
  fgDisabled: '#4b4d52',
  /** Disabled glyphs. */
  fgDisabled2: '#3a3c41',

  accent: '#56c39a',
  accentHi: '#74dcb4',
  accentLo: '#3da581',
  /** Dashed affordance border ("+ buy slot" when affordable). */
  accentDashed: '#3d5c4e',

  gold: '#d2a04c',
  goldHi: '#f5d98a',

  overlay: 'rgba(10,11,13,.7)',
  overlaySoft: 'rgba(10,11,13,.62)',
} as const;

/** RGB triplets for `rgba(var(--x-rgb), a)` alpha variants. */
export const rgb = {
  accent: '86,195,154',
  gold: '210,160,76',
  rare: '143,208,230',
  epic: '143,99,232',
  epicText: '201,164,255',
} as const;

/**
 * Rarity treatments, keyed by rarity id from src/content/rarities.json. `border`/`glow` are
 * what a bank cell uses; `borderFeed` is the brighter ring the drop feed uses on a fresh drop.
 * Common has no treatment — the cell's normal border/background is the baseline.
 */
export interface RarityTreatment {
  /** Text / tag colour. */
  color: string;
  border: string;
  borderFeed: string;
  /** Box-shadow glow. Only applied in "juicy" feel. */
  glow: string;
  glowFeed: string;
  /** Tag-chip border. */
  tagBorder: string;
}
export const rarity: Readonly<Record<string, RarityTreatment>> = {
  rare: {
    color: '#8fd0e6',
    border: '#4d8ba3',
    borderFeed: '#4d8ba3',
    glow: 'rgba(143,208,230,.25)',
    glowFeed: 'rgba(143,208,230,.25)',
    tagBorder: 'rgba(143,208,230,.35)',
  },
  epic: {
    color: '#c9a4ff',
    border: '#53398f',
    borderFeed: '#8f63e8',
    glow: 'rgba(143,99,232,.3)',
    glowFeed: 'rgba(143,99,232,.45)',
    tagBorder: 'rgba(201,164,255,.4)',
  },
};

export const font = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** Type scale in px. Mono carries numbers and labels; sans carries names and headings. */
export const fontSize = {
  tag: 8,
  label: 9,
  hint: 10,
  meta: 11,
  body: 12,
  name: 13,
  lead: 14,
  title: 15,
  heading: 20,
  display: 34,
} as const;

/** Letter-spacing (em) for uppercase mono labels. */
export const tracking = {
  brandSub: '.34em',
  label: '.22em',
  brand: '.16em',
  chip: '.14em',
  tag: '.12em',
  button: '.1em',
  tab: '.06em',
} as const;

export const radius = {
  xs: 3,
  sm: 4,
  chip: 5,
  md: 6,
  cell: 7,
  panel: 8,
  modal: 10,
} as const;

/** Icon tiles: outer size, corner radius, icon size. From the screens, by context. */
export const tile = {
  /** Drop feed, recap rows. */
  sm: { size: 30, radius: 5, icon: 20 },
  /** Tool slot. */
  tool: { size: 34, radius: 6, icon: 22 },
  /** Node rows (veins, trees). */
  md: { size: 36, radius: 6, icon: 24 },
  /** Loot / sell modals. */
  lg: { size: 40, radius: 6, icon: 26 },
  /** Active action, selected item. */
  xl: { size: 52, radius: 7, icon: 34 },
  /** Bank grid cells are square, min 72px, radius 7, icon 26. */
  bank: { size: 72, radius: 7, icon: 26 },
} as const;

export const layout = {
  sidebarWidth: 224,
  /** Below this viewport width the sidebar becomes a bottom tab bar. */
  narrowBreakpoint: 700,
  progressBarHeight: 20,
  xpBarHeight: 6,
} as const;

export const motion = {
  fast: '.15s',
  /** Floating "+68 xp" pops. */
  pop: '1.1s',
  levelUp: '4s',
  ring: '.9s',
  ringSlow: '1.3s',
  /** Rare-drop toast lifetime (ms). */
  toastMs: 2600,
} as const;

/** "Feel" setting from the design: how much the UI celebrates. */
export type Juice = 'deadpan' | 'quiet' | 'juicy';

export const theme = {
  color,
  rgb,
  rarity,
  font,
  fontSize,
  tracking,
  radius,
  tile,
  layout,
  motion,
} as const;
export type Theme = typeof theme;
