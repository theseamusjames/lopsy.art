import { describe, it, expect } from 'vitest';
import { hitTestTextLayer, type RenderedSize } from './text-hit-test';
import type { TextLayer } from '../../types';

function makeTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 'text-1',
    name: 'Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 40,
    y: 200,
    clipToBelow: false,
    effects: {} as TextLayer['effects'],
    mask: null,
    text: 'HELLO',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 0, g: 0, b: 0, a: 1 },
    lineHeight: 1.2,
    letterSpacing: 0,
    paragraphSpacing: 0,
    textAlign: 'left',
    width: null,
    underline: false,
    strikethrough: false,
    vertical: false,
    ...overrides,
  };
}

describe('hitTestTextLayer', () => {
  it('hits a single-line point-text layer within its estimated bounds', () => {
    const layer = makeTextLayer({ text: 'HELLO', fontSize: 24, x: 40, y: 200 });
    const hit = hitTestTextLayer([layer], { x: 60, y: 210 });
    expect(hit).toBe(layer);
  });

  it('#845 — a multi-line layer whose lines are short does not hit-test as wide as ALL lines combined', () => {
    // "ITEM ONE\nITEM TWO\nITEM THREE" — longest line is "ITEM THREE" (10 chars),
    // but the total character count across all lines (including newlines) is
    // 28. At fontSize 24 the buggy width (28 * 24 * 0.6 = 403.2) reaches all
    // the way to x=443, while the correct width (10 * 24 * 0.6 = 144) stops at
    // x=184. A click at x=400 must NOT be treated as inside this layer.
    const layer = makeTextLayer({
      text: 'ITEM ONE\nITEM TWO\nITEM THREE',
      fontSize: 24,
      x: 40,
      y: 200,
    });

    const farRightClick = hitTestTextLayer([layer], { x: 400, y: 240 });
    expect(farRightClick).toBeNull();

    const onGlyphsClick = hitTestTextLayer([layer], { x: 100, y: 240 });
    expect(onGlyphsClick).toBe(layer);
  });

  it('uses the longest line, not the first or last line, for the width estimate', () => {
    // Middle line is the longest; a click past the first/last line's length
    // but within the middle line's length must still hit.
    const layer = makeTextLayer({
      text: 'A\nMUCH LONGER LINE\nB',
      fontSize: 20,
      x: 0,
      y: 0,
    });
    // Longest line "MUCH LONGER LINE" has 16 chars -> width = 16*20*0.6 = 192.
    const withinLongestLine = hitTestTextLayer([layer], { x: 150, y: 10 });
    expect(withinLongestLine).toBe(layer);

    const beyondLongestLine = hitTestTextLayer([layer], { x: 250, y: 10 });
    expect(beyondLongestLine).toBeNull();
  });

  it('#845 — height estimate grows with paragraphSpacing between lines', () => {
    const withoutSpacing = makeTextLayer({
      text: 'LINE ONE\nLINE TWO\nLINE THREE',
      fontSize: 20,
      lineHeight: 1.2,
      paragraphSpacing: 0,
      x: 0,
      y: 0,
    });
    const withSpacing = makeTextLayer({
      ...withoutSpacing,
      paragraphSpacing: 50,
    });

    // Base height: 20 * 1.2 * 3 = 72. A y just past that must miss the
    // no-spacing layer but hit the layer with 2 gaps of 50px added (72 + 100 = 172).
    const y = 100;
    expect(hitTestTextLayer([withoutSpacing], { x: 10, y })).toBeNull();
    expect(hitTestTextLayer([withSpacing], { x: 10, y })).toBe(withSpacing);
  });

  it('returns null when no layer contains the point', () => {
    const layer = makeTextLayer({ text: 'HI', fontSize: 24, x: 0, y: 0 });
    expect(hitTestTextLayer([layer], { x: 1000, y: 1000 })).toBeNull();
  });

  it('ignores invisible and locked layers', () => {
    const invisible = makeTextLayer({ id: 'a', visible: false });
    const locked = makeTextLayer({ id: 'b', locked: true });
    expect(hitTestTextLayer([invisible], { x: 60, y: 210 })).toBeNull();
    expect(hitTestTextLayer([locked], { x: 60, y: 210 })).toBeNull();
  });

  it('prefers the topmost (last) matching layer', () => {
    const bottom = makeTextLayer({ id: 'bottom', text: 'HELLO', x: 40, y: 200 });
    const top = makeTextLayer({ id: 'top', text: 'HELLO', x: 40, y: 200 });
    expect(hitTestTextLayer([bottom, top], { x: 60, y: 210 })).toBe(top);
  });
});

function makeCapsLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return makeTextLayer({ text: 'HELLO', fontSize: 120, lineHeight: 1.4, x: 40, y: 74, ...overrides });
}

function sizes(map: Record<string, RenderedSize>) {
  return (id: string): RenderedSize | null => map[id] ?? null;
}

describe('hitTestTextLayer with rendered sizes (#989)', () => {
  // 120px caps "HELLO": ink ≈ y 78→167, texture = ink + 4px padding each side.
  const layer = makeCapsLayer();
  const rendered = sizes({ [layer.id]: { width: 420, height: 97 } });

  it('hits clicks on the glyphs', () => {
    expect(hitTestTextLayer([layer], { x: 60, y: 120 }, rendered)?.id).toBe(layer.id);
    expect(hitTestTextLayer([layer], { x: 450, y: 168 }, rendered)?.id).toBe(layer.id);
  });

  it('misses empty canvas below the ink that the line box used to cover', () => {
    // The line-box estimate reaches y = 74 + 120 × 1.4 = 242.
    expect(hitTestTextLayer([layer], { x: 60, y: 207 })?.id).toBe(layer.id);
    expect(hitTestTextLayer([layer], { x: 60, y: 207 }, rendered)).toBeNull();
  });

  it('misses empty canvas above and beside the ink', () => {
    expect(hitTestTextLayer([layer], { x: 60, y: 60 }, rendered)).toBeNull();
    expect(hitTestTextLayer([layer], { x: 480, y: 120 }, rendered)).toBeNull();
  });

  it('hits the gap between lines of multi-line text', () => {
    const multi = makeCapsLayer({ text: 'HELLO\nWORLD' });
    const lookup = sizes({ [multi.id]: { width: 420, height: 265 } });
    expect(hitTestTextLayer([multi], { x: 60, y: 190 }, lookup)?.id).toBe(multi.id);
  });

  it('keeps the whole area-text box width clickable', () => {
    const area = makeCapsLayer({ width: 600 });
    const lookup = sizes({ [area.id]: { width: 200, height: 97 } });
    expect(hitTestTextLayer([area], { x: 500, y: 120 }, lookup)?.id).toBe(area.id);
  });

  it('falls back to the estimate when the size is unknown or degenerate', () => {
    const lookup = sizes({ [layer.id]: { width: 1, height: 1 } });
    expect(hitTestTextLayer([layer], { x: 60, y: 207 }, lookup)?.id).toBe(layer.id);
    expect(hitTestTextLayer([layer], { x: 60, y: 207 }, () => null)?.id).toBe(layer.id);
  });
});

describe('hitTestTextLayer with transformed layers', () => {
  // A layout box 100×20 turned 45° about its anchor at (200, 200).
  const s = Math.SQRT1_2;
  const frame = {
    anchor: { x: 200, y: 200 },
    matrix: { a: s, b: s, c: -s, d: s },
    box: { x: 0, y: 0, width: 100, height: 20 },
  };
  const layer = makeTextLayer({
    x: 180,
    y: 190,
    transform: { a: s, b: s, c: -s, d: s, anchorX: 20, anchorY: 10 },
  });
  const bigTexture = (): RenderedSize => ({ width: 200, height: 200 });

  it('hits clicks along the rotated text', () => {
    // 50px along the baseline direction from the anchor.
    expect(hitTestTextLayer([layer], { x: 200 + 50 * s, y: 200 + 50 * s }, bigTexture, () => frame)).toBe(layer);
  });

  it('ignores clicks in the empty corners of its axis-aligned texture', () => {
    expect(hitTestTextLayer([layer], { x: 370, y: 200 }, bigTexture, () => frame)).toBeNull();
  });

  it('falls back to the texture box when no frame is available', () => {
    expect(hitTestTextLayer([layer], { x: 370, y: 200 }, bigTexture)).toBe(layer);
  });
});
