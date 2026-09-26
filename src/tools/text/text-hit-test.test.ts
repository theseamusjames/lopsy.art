import { describe, it, expect } from 'vitest';
import { hitTestTextLayer } from './text-hit-test';
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
