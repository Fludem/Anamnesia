import { describe, expect, it } from 'vitest';

import { BACKGROUND_PATH, extractIconPath } from './svg-extract.ts';

const wrap = (inner: string, attrs = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"') =>
  `<svg ${attrs}>${inner}</svg>`;
const bg = `<path d="${BACKGROUND_PATH}"/>`;

describe('extractIconPath', () => {
  it('extracts the single foreground path from a standard icon', () => {
    const svg = wrap(`${bg}<path fill="#fff" d="M10 10h20v20H10z"/>`);
    expect(extractIconPath(svg)).toEqual({ ok: true, d: 'M10 10h20v20H10z' });
  });

  it('tolerates whitespace, an XML prolog, and comments', () => {
    const svg = `<?xml version="1.0"?>\n<!-- hi -->\n${wrap(`\n  ${bg}\n  <path fill="#fff" d="M1 1L2 2"/>\n`)}\n`;
    expect(extractIconPath(svg)).toEqual({ ok: true, d: 'M1 1L2 2' });
  });

  it('concatenates multiple foreground paths', () => {
    const svg = wrap(`${bg}<path fill="#fff" d="M1 1h1"/><path fill="#fff" d="m5 5h1"/>`);
    expect(extractIconPath(svg)).toEqual({ ok: true, d: 'M1 1h1 m5 5h1' });
  });

  it('rejects a missing background rect', () => {
    expect(extractIconPath(wrap(`<path fill="#fff" d="M1 1h1"/>`))).toEqual({
      ok: false,
      error: 'first path is not the background rect',
    });
  });

  it('rejects an icon with only a background', () => {
    expect(extractIconPath(wrap(bg))).toEqual({ ok: false, error: 'no foreground path' });
  });

  it('rejects a wrong viewBox', () => {
    const svg = wrap(`${bg}<path d="M1 1"/>`, 'xmlns="x" viewBox="0 0 100 100"');
    expect(extractIconPath(svg)).toEqual({ ok: false, error: 'unexpected viewBox "0 0 100 100"' });
  });

  it('rejects groups, transforms, and non-path elements', () => {
    expect(extractIconPath(wrap(`${bg}<g><path d="M1 1"/></g>`))).toEqual({
      ok: false,
      error: 'unexpected element <g>',
    });
    expect(extractIconPath(wrap(`${bg}<path transform="scale(2)" d="M1 1"/>`))).toEqual({
      ok: false,
      error: 'unexpected <path> attribute "transform"',
    });
    expect(extractIconPath(wrap(`${bg}<circle r="5"/>`))).toEqual({
      ok: false,
      error: 'unexpected element <circle>',
    });
    expect(extractIconPath(wrap(`${bg}<path fill-rule="evenodd" d="M1 1"/>`))).toEqual({
      ok: false,
      error: 'unexpected <path> attribute "fill-rule"',
    });
  });

  it('rejects stray text and a foreground path that does not start with a moveto', () => {
    expect(extractIconPath(wrap(`${bg}hello<path d="M1 1"/>`))).toEqual({
      ok: false,
      error: 'unexpected text content between elements',
    });
    expect(extractIconPath(wrap(`${bg}<path d="L1 1"/>`))).toEqual({
      ok: false,
      error: 'foreground path does not start with a moveto',
    });
  });

  it('rejects non-svg input', () => {
    expect(extractIconPath('<html></html>')).toEqual({ ok: false, error: 'no <svg> root element' });
  });
});
