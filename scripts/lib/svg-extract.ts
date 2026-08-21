/**
 * Extracts the foreground path geometry from a game-icons SVG.
 *
 * Every icon in the upstream set has the same shape:
 *   <svg xmlns="…" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="…"/></svg>
 *
 * This extractor is deliberately strict. Anything outside that shape (groups, transforms,
 * circles, styles, fill-rules…) is reported as an error rather than silently mangled, so an
 * upstream change shows up as a failed build instead of a broken icon.
 */

export const BACKGROUND_PATH = 'M0 0h512v512H0z';
export const EXPECTED_VIEWBOX = '0 0 512 512';

export type ExtractResult = { ok: true; d: string } | { ok: false; error: string };

const ALLOWED_SVG_ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height']);
const ALLOWED_PATH_ATTRS = new Set(['d', 'fill']);

/** Parses `name="value"` pairs from an element's attribute string. */
function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs.set(m[1]!, m[2]!);
  }
  return attrs;
}

export function extractIconPath(svg: string): ExtractResult {
  const body = svg.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();

  const svgOpen = /^<svg\b([^>]*)>/.exec(body);
  if (!svgOpen) return { ok: false, error: 'no <svg> root element' };
  if (!body.endsWith('</svg>')) return { ok: false, error: 'missing </svg>' };

  const svgAttrs = parseAttrs(svgOpen[1]!);
  if (svgAttrs.get('viewBox') !== EXPECTED_VIEWBOX) {
    return { ok: false, error: `unexpected viewBox "${svgAttrs.get('viewBox') ?? ''}"` };
  }
  for (const name of svgAttrs.keys()) {
    if (!ALLOWED_SVG_ATTRS.has(name)) return { ok: false, error: `unexpected <svg> attribute "${name}"` };
  }

  const inner = body.slice(svgOpen[0].length, -'</svg>'.length);

  // Every element inside must be a self-closing <path …/>, with nothing but whitespace between.
  const elements = [...inner.matchAll(/<(\/?)([\w:-]+)\b([^>]*?)(\/?)>/g)];
  const leftover = inner.replace(/<(\/?)([\w:-]+)\b([^>]*?)(\/?)>/g, '').trim();
  if (leftover.length > 0) return { ok: false, error: 'unexpected text content between elements' };

  const ds: string[] = [];
  for (const [, closing, tag, rawAttrs, selfClose] of elements) {
    if (closing) return { ok: false, error: `unexpected closing tag </${tag}>` };
    if (tag !== 'path') return { ok: false, error: `unexpected element <${tag}>` };
    if (!selfClose) return { ok: false, error: '<path> is not self-closing' };
    const attrs = parseAttrs(rawAttrs!);
    for (const name of attrs.keys()) {
      if (!ALLOWED_PATH_ATTRS.has(name)) return { ok: false, error: `unexpected <path> attribute "${name}"` };
    }
    const d = attrs.get('d');
    if (!d) return { ok: false, error: '<path> without d' };
    ds.push(d.trim());
  }

  if (ds[0] !== BACKGROUND_PATH) return { ok: false, error: 'first path is not the background rect' };
  const fg = ds.slice(1);
  if (fg.length === 0) return { ok: false, error: 'no foreground path' };
  for (const d of fg) {
    if (!/^[Mm]/.test(d)) return { ok: false, error: 'foreground path does not start with a moveto' };
  }
  // Concatenating path data is valid when each segment begins with an absolute moveto;
  // a relative `m` at the start of a path is treated as absolute by the spec anyway.
  return { ok: true, d: fg.join(' ') };
}
