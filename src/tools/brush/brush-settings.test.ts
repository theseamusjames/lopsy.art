import { describe, it, expect } from 'vitest';
import { DEFAULT_BRUSH_SETTINGS, clampBrushSetting } from './brush-settings';

describe('brush-settings (#453)', () => {
  it('exposes legacy flat-bag defaults', () => {
    expect(DEFAULT_BRUSH_SETTINGS).toEqual({
      size: 10,
      opacity: 100,
      hardness: 80,
      spacing: 0,
      scatter: 0,
      angle: 0,
      fade: 0,
      taper: 0,
    });
  });

  it('clamps size into [1, 5000]', () => {
    expect(clampBrushSetting('size', -10)).toBe(1);
    expect(clampBrushSetting('size', 0)).toBe(1);
    expect(clampBrushSetting('size', 250)).toBe(250);
    expect(clampBrushSetting('size', 99999)).toBe(5000);
  });

  it('clamps opacity into [1, 100] to avoid a silent no-op stroke', () => {
    // The eraser / healing / spray / brush opacity setters all clamp
    // to 1 not 0 — the warn-once dedupe in the store catches the 0–1
    // normalised footgun, and the clamp keeps a stroke visible even
    // after the dedupe has fired once.
    expect(clampBrushSetting('opacity', -5)).toBe(1);
    expect(clampBrushSetting('opacity', 0)).toBe(1);
    expect(clampBrushSetting('opacity', 50)).toBe(50);
    expect(clampBrushSetting('opacity', 200)).toBe(100);
  });

  it('clamps hardness into [0, 100]', () => {
    expect(clampBrushSetting('hardness', -10)).toBe(0);
    expect(clampBrushSetting('hardness', 0)).toBe(0);
    expect(clampBrushSetting('hardness', 50)).toBe(50);
    expect(clampBrushSetting('hardness', 999)).toBe(100);
  });

  it('clamps spacing into [0, 200]', () => {
    expect(clampBrushSetting('spacing', -1)).toBe(0);
    expect(clampBrushSetting('spacing', 50)).toBe(50);
    expect(clampBrushSetting('spacing', 9999)).toBe(200);
  });

  it('clamps scatter into [0, 100]', () => {
    expect(clampBrushSetting('scatter', -1)).toBe(0);
    expect(clampBrushSetting('scatter', 25)).toBe(25);
    expect(clampBrushSetting('scatter', 9999)).toBe(100);
  });

  it('wraps angle into [0, 360) modulo', () => {
    // Replicates the legacy `setBrushAngle` shape — callers can pass
    // a delta that goes negative or above 360 (e.g. via a wheel) and
    // the shader gets a clean modulo-wrapped degree value.
    expect(clampBrushSetting('angle', 0)).toBe(0);
    expect(clampBrushSetting('angle', 45)).toBe(45);
    expect(clampBrushSetting('angle', 360)).toBe(0);
    expect(clampBrushSetting('angle', 720)).toBe(0);
    expect(clampBrushSetting('angle', -90)).toBe(270);
    expect(clampBrushSetting('angle', -450)).toBe(270);
  });

  it('clamps fade into [0, 5000]', () => {
    expect(clampBrushSetting('fade', -1)).toBe(0);
    expect(clampBrushSetting('fade', 250)).toBe(250);
    expect(clampBrushSetting('fade', 99999)).toBe(5000);
  });

  it('clamps taper into [0, 5000]', () => {
    expect(clampBrushSetting('taper', -1)).toBe(0);
    expect(clampBrushSetting('taper', 250)).toBe(250);
    expect(clampBrushSetting('taper', 99999)).toBe(5000);
  });

  it('preserves sub-pixel values within range', () => {
    // Several read sites take the value through floating-point math
    // (e.g. `brushHardness / 100` in paint-handlers) so the slice
    // must round-trip fractional values within the clamp range.
    expect(clampBrushSetting('size', 12.5)).toBe(12.5);
    expect(clampBrushSetting('hardness', 33.3)).toBe(33.3);
    expect(clampBrushSetting('spacing', 17.7)).toBe(17.7);
  });
});
