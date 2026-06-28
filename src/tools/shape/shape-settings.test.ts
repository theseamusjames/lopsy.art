import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHAPE_SETTINGS,
  clampShapeSetting,
  type ShapeSettings,
} from './shape-settings';

describe('shape-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_SHAPE_SETTINGS).toEqual({
      mode: 'ellipse',
      output: 'pixels',
      fillColor: { r: 255, g: 255, b: 255, a: 1 },
      strokeColor: null,
      strokeWidth: 2,
      polygonSides: 6,
      cornerRadius: 0,
    } satisfies ShapeSettings);
  });

  it('mode collapses unknown strings to "ellipse" rather than letting a typed-string bypass leave a polygon-with-stale-sides render (#236)', () => {
    expect(clampShapeSetting('mode', 'ellipse')).toBe('ellipse');
    expect(clampShapeSetting('mode', 'polygon')).toBe('polygon');
    // The shader treats anything-not-ellipse as polygon. A bypass passing
    // 'rectangle' must not silently render a polygon with whatever sides
    // value is current — fall back to the documented default instead.
    expect(clampShapeSetting('mode', 'rectangle' as 'ellipse')).toBe('ellipse');
    expect(clampShapeSetting('mode', 'line' as 'ellipse')).toBe('ellipse');
    expect(clampShapeSetting('mode', 'arrow' as 'ellipse')).toBe('ellipse');
  });

  it('output collapses unknown strings to "pixels" for the same reason', () => {
    expect(clampShapeSetting('output', 'pixels')).toBe('pixels');
    expect(clampShapeSetting('output', 'path')).toBe('path');
    expect(clampShapeSetting('output', 'vector' as 'pixels')).toBe('pixels');
    expect(clampShapeSetting('output', '' as 'pixels')).toBe('pixels');
  });

  it('clamps strokeWidth into [1, 50]', () => {
    expect(clampShapeSetting('strokeWidth', 0)).toBe(1);
    expect(clampShapeSetting('strokeWidth', -5)).toBe(1);
    expect(clampShapeSetting('strokeWidth', 999)).toBe(50);
    expect(clampShapeSetting('strokeWidth', 2)).toBe(2);
    expect(clampShapeSetting('strokeWidth', 50)).toBe(50);
    expect(clampShapeSetting('strokeWidth', 1)).toBe(1);
  });

  it('clamps and rounds polygonSides into [3, 64]', () => {
    // Sides must be an integer — fractional sides would render as the
    // floor count with weird seams. The legacy setter rounded, preserve.
    expect(clampShapeSetting('polygonSides', 2)).toBe(3);
    expect(clampShapeSetting('polygonSides', 0)).toBe(3);
    expect(clampShapeSetting('polygonSides', 99)).toBe(64);
    expect(clampShapeSetting('polygonSides', 6.4)).toBe(6);
    expect(clampShapeSetting('polygonSides', 6.6)).toBe(7);
    expect(clampShapeSetting('polygonSides', 3)).toBe(3);
    expect(clampShapeSetting('polygonSides', 64)).toBe(64);
  });

  it('clamps cornerRadius into [0, 200]', () => {
    expect(clampShapeSetting('cornerRadius', -1)).toBe(0);
    expect(clampShapeSetting('cornerRadius', 0)).toBe(0);
    expect(clampShapeSetting('cornerRadius', 99999)).toBe(200);
    expect(clampShapeSetting('cornerRadius', 100)).toBe(100);
    expect(clampShapeSetting('cornerRadius', 200)).toBe(200);
  });

  it('does not round numeric fields outside polygonSides', () => {
    // Sub-pixel stroke widths and corner radii are meaningful for HDPI
    // rendering and animations, so the clamps guard the bounds without
    // forcing integers (polygonSides is the lone exception — see above).
    expect(clampShapeSetting('strokeWidth', 2.5)).toBe(2.5);
    expect(clampShapeSetting('cornerRadius', 12.75)).toBe(12.75);
  });

  it('passes fillColor and strokeColor through unchanged, including null', () => {
    const red = { r: 255, g: 0, b: 0, a: 1 };
    expect(clampShapeSetting('fillColor', red)).toBe(red);
    expect(clampShapeSetting('fillColor', null)).toBe(null);
    expect(clampShapeSetting('strokeColor', null)).toBe(null);
    expect(clampShapeSetting('strokeColor', red)).toBe(red);
  });
});
