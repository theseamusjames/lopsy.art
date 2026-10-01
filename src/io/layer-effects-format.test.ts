import { describe, it, expect } from 'vitest';
import {
  STROKED_SILHOUETTE_VERSION,
  blurredEdgeRatio,
  effectsForFormatVersion,
  migrateEffectsToStrokedSilhouette,
  parsePsdEffects,
  parseStoredEffects,
  pullOffsetBack,
  serializePsdEffects,
  strokeSilhouetteReach,
} from './layer-effects-format';
import { FORMAT_VERSION, serializeLayer } from './project-save';
import { deserializeLayer } from './project-load';
import { DEFAULT_EFFECTS } from '../layers/layer-model';
import type { LayerEffects, StrokeEffect } from '../types/effects';
import type { RasterLayer } from '../types/layers';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };

function stroke(width: number, position: StrokeEffect['position'] = 'outside'): StrokeEffect {
  return { enabled: true, color: { r: 0, g: 208, b: 255, a: 1 }, width, position };
}

function withEffects(overrides: Partial<LayerEffects>): LayerEffects {
  return { ...DEFAULT_EFFECTS, ...overrides };
}

function shadow(offsetX: number, offsetY: number, blur: number, spread = 0, opacity = 1): LayerEffects['dropShadow'] {
  return { enabled: true, color: BLACK, offsetX, offsetY, blur, spread, opacity };
}

function glow(size: number, spread = 0, opacity = 0.75): LayerEffects['outerGlow'] {
  return { enabled: true, color: { r: 255, g: 255, b: 100, a: 1 }, size, spread, opacity };
}

// ── An independent 1-D model of a straight right-hand edge ────────────────
// Pixel x ≤ edge is inside the silhouette. The engine blurs the silhouette
// with its separable Gaussian, applies the spread curve and multiplies by
// opacity; the stroke ring (pixels 1..reach past the layer edge at 0) is
// drawn on top, so only pixels > reach show the effect.

function kernel(blur: number): number[] {
  const radius = Math.min(Math.ceil(blur), 63);
  if (radius === 0) return [1];
  const sigma = radius / 3;
  const w: number[] = [];
  for (let i = -radius; i <= radius; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

/** Effect alpha at pixel x for a silhouette ending at `edge`. */
function effectAlpha(x: number, edge: number, blur: number, spread: number, opacity: number): number {
  const k = kernel(blur);
  const radius = (k.length - 1) / 2;
  let a = 0;
  for (let i = -radius; i <= radius; i++) if (x - i <= edge) a += k[i + radius]!;
  const exponent = spread > 0.5 ? Math.max(1 - spread / 100, 0.001) : 1;
  return (a > 0.001 ? Math.pow(a, exponent) : 0) * opacity;
}

/** What shows past the ring along the shadow's leading axis, old vs migrated. */
function shadowProfiles(reach: number, offset: number, blur: number, spread: number): { old: number[]; migrated: number[] } {
  const effects = withEffects({ stroke: stroke(reach), dropShadow: shadow(offset, offset, blur, spread) });
  const m = migrateEffectsToStrokedSilhouette(effects).dropShadow;
  const xs = Array.from({ length: 80 }, (_, i) => reach + 1 + i);
  return {
    // Before: cast from the layer alone (edge 0), shifted by the offset.
    old: xs.map((x) => effectAlpha(x, offset, blur, spread, 1)),
    // Now: cast from the layer plus the ring (edge = reach), shifted by the migrated offset.
    migrated: xs.map((x) => effectAlpha(x, reach + m.offsetX, blur, spread, m.opacity)),
  };
}

describe('strokeSilhouetteReach', () => {
  it('is the width outside and half the width centred', () => {
    expect(strokeSilhouetteReach(stroke(12))).toBe(12);
    expect(strokeSilhouetteReach(stroke(16, 'center'))).toBe(8);
  });

  it('rounds a fractional reach the way the engine draws the ring', () => {
    // ≤ 10 px: distance search paints pixels within the reach → floor.
    expect(strokeSilhouetteReach(stroke(5, 'center'))).toBe(2);
    // > 10 px: dilation at radius ceil(reach).
    expect(strokeSilhouetteReach(stroke(21, 'center'))).toBe(11);
  });

  it('is 0 for inside, disabled, zero-width and transparent strokes', () => {
    expect(strokeSilhouetteReach(stroke(12, 'inside'))).toBe(0);
    expect(strokeSilhouetteReach({ ...stroke(12), enabled: false })).toBe(0);
    expect(strokeSilhouetteReach(stroke(0))).toBe(0);
    expect(strokeSilhouetteReach({ ...stroke(12), color: { r: 0, g: 0, b: 0, a: 0 } })).toBe(0);
  });
});

describe('pullOffsetBack', () => {
  it('moves each component toward 0 by the reach, never past it', () => {
    expect(pullOffsetBack(20, 12)).toBe(8);
    expect(pullOffsetBack(-20, 12)).toBe(-8);
    expect(pullOffsetBack(5, 12)).toBe(0);
    expect(pullOffsetBack(-5, 12)).toBe(0);
    expect(pullOffsetBack(0, 12)).toBe(0);
  });
});

describe('blurredEdgeRatio', () => {
  it('is 1 with no blur or nothing hidden', () => {
    expect(blurredEdgeRatio(0, 5, 0)).toBe(1);
    expect(blurredEdgeRatio(8, 0, 0)).toBe(1);
  });

  it('is 0 once the hidden band is wider than the kernel', () => {
    expect(blurredEdgeRatio(12, 12, 0)).toBe(0);
  });

  it('applies the spread curve', () => {
    const plain = blurredEdgeRatio(10, 3, 0);
    expect(plain).toBeGreaterThan(0);
    expect(plain).toBeLessThan(1);
    expect(blurredEdgeRatio(10, 3, 50)).toBeCloseTo(Math.sqrt(plain), 10);
  });
});

describe('migrateEffectsToStrokedSilhouette — drop shadow', () => {
  it('pulls a hard shadow back by the stroke so its edges stay put', () => {
    const effects = withEffects({ stroke: stroke(12), dropShadow: shadow(20, 20, 0) });
    const m = migrateEffectsToStrokedSilhouette(effects).dropShadow;
    expect(m.offsetX).toBe(8);
    expect(m.offsetY).toBe(8);
    expect(m.opacity).toBe(1);
    // Leading edge: layer edge + offset before, ring edge + new offset now.
    expect(12 + m.offsetX).toBe(20);
  });

  it('keeps the sign of negative offsets', () => {
    const effects = withEffects({ stroke: stroke(16, 'center'), dropShadow: shadow(-20, 30, 0) });
    const m = migrateEffectsToStrokedSilhouette(effects).dropShadow;
    expect(m.offsetX).toBe(-12);
    expect(m.offsetY).toBe(22);
  });

  it.each([
    [12, 20, 0, 0],
    [2, 4, 8, 0],
    [12, 30, 12, 40],
    [8, 9, 20, 0],
  ])('reach %i, offset %i, blur %i, spread %i: the profile past the ring is unchanged', (reach, offset, blur, spread) => {
    const { old, migrated } = shadowProfiles(reach, offset, blur, spread);
    for (let i = 0; i < old.length; i++) expect(migrated[i]).toBeCloseTo(old[i]!, 6);
  });

  it.each([
    [2, 0, 8, 0],
    [12, 0, 12, 0],
    [12, 4, 30, 0],
    [6, 2, 16, 60],
  ])('reach %i, offset %i, blur %i, spread %i: the first pixel past the ring keeps its old darkness', (reach, offset, blur, spread) => {
    const { old, migrated } = shadowProfiles(reach, offset, blur, spread);
    expect(migrated[0]).toBeCloseTo(old[0]!, 6);
  });

  it('scales only the opacity the migration actually needs', () => {
    // Leading axis X clears the stroke (20 > 12), so no opacity change even
    // though Y (4 < 12) was partly hidden.
    const effects = withEffects({ stroke: stroke(12), dropShadow: shadow(20, 4, 10) });
    const m = migrateEffectsToStrokedSilhouette(effects).dropShadow;
    expect(m).toMatchObject({ offsetX: 8, offsetY: 0, opacity: 1 });
  });

  it('falls back to the color alpha when an old file has no shadow opacity', () => {
    const legacy = { enabled: true, color: { ...BLACK, a: 0.75 }, offsetX: 0, offsetY: 0, blur: 8, spread: 0 };
    const effects = parseStoredEffects({ stroke: stroke(2), dropShadow: legacy });
    const m = migrateEffectsToStrokedSilhouette(effects).dropShadow;
    expect(m.opacity).toBeCloseTo(0.75 * blurredEdgeRatio(8, 2, 0), 10);
  });
});

describe('migrateEffectsToStrokedSilhouette — outer glow', () => {
  it.each([
    [2, 10, 0],
    [3, 15, 0],
    [4, 20, 50],
  ])('reach %i, size %i, spread %i: the first pixel past the ring keeps its old strength', (reach, size, spread) => {
    const effects = withEffects({ stroke: stroke(reach), outerGlow: glow(size, spread) });
    const m = migrateEffectsToStrokedSilhouette(effects).outerGlow;
    expect(m.size).toBe(size);
    const old = effectAlpha(reach + 1, 0, size, spread, 0.75);
    expect(effectAlpha(reach + 1, reach, size, spread, m.opacity)).toBeCloseTo(old, 6);
    expect(m.opacity).toBeLessThan(0.75);
  });

  it('leaves an unblurred (size < 2) glow alone', () => {
    const effects = withEffects({ stroke: stroke(4), outerGlow: glow(1) });
    expect(migrateEffectsToStrokedSilhouette(effects).outerGlow).toBe(effects.outerGlow);
  });

  it('a glow the stroke used to bury stays (nearly) invisible', () => {
    const effects = withEffects({ stroke: stroke(12), outerGlow: glow(16, 0, 1) });
    expect(migrateEffectsToStrokedSilhouette(effects).outerGlow.opacity).toBeLessThan(0.02);
  });
});

describe('migrateEffectsToStrokedSilhouette — what it leaves alone', () => {
  it('returns the same effects without an outside-reaching stroke', () => {
    const noStroke = withEffects({ dropShadow: shadow(20, 20, 0), outerGlow: glow(10) });
    expect(migrateEffectsToStrokedSilhouette(noStroke)).toBe(noStroke);
    const inside = withEffects({ stroke: stroke(12, 'inside'), dropShadow: shadow(20, 20, 0) });
    expect(migrateEffectsToStrokedSilhouette(inside)).toBe(inside);
  });

  it('leaves disabled shadows and glows, the stroke and inner glow as they were', () => {
    const effects = withEffects({
      stroke: stroke(12),
      dropShadow: { ...shadow(20, 20, 0), enabled: false },
      outerGlow: { ...glow(10), enabled: false },
    });
    expect(migrateEffectsToStrokedSilhouette(effects)).toBe(effects);

    const live = withEffects({ stroke: stroke(12), dropShadow: shadow(20, 20, 0), innerGlow: { ...glow(10), enabled: true } });
    const m = migrateEffectsToStrokedSilhouette(live);
    expect(m.stroke).toBe(live.stroke);
    expect(m.innerGlow).toBe(live.innerGlow);
    expect(m.colorOverlay).toBe(live.colorOverlay);
  });
});

describe('format versions', () => {
  const effects = withEffects({ stroke: stroke(12), dropShadow: shadow(20, 20, 0) });

  it('new saves are written at a version that is not migrated again', () => {
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(STROKED_SILHOUETTE_VERSION);
    expect(effectsForFormatVersion(effects, FORMAT_VERSION)).toBe(effects);
  });

  it('v1 effects are migrated', () => {
    expect(effectsForFormatVersion(effects, 1).dropShadow.offsetX).toBe(8);
  });

  function layerWith(fx: LayerEffects): RasterLayer {
    return {
      id: 'r1', name: 'Square', type: 'raster', visible: true, locked: false, opacity: 1,
      blendMode: 'normal', x: 200, y: 150, clipToBelow: false, effects: fx, mask: null,
      width: 200, height: 100,
    };
  }

  it('deserializeLayer migrates a v1 layer and keeps a current one', () => {
    const saved = JSON.parse(JSON.stringify(serializeLayer(layerWith(effects), 0, -1, 200, 100)));
    expect(deserializeLayer(saved, 1).effects.dropShadow).toMatchObject({ offsetX: 8, offsetY: 8 });
    expect(deserializeLayer(saved, FORMAT_VERSION).effects.dropShadow).toMatchObject({ offsetX: 20, offsetY: 20 });
    expect(deserializeLayer(saved).effects.dropShadow).toMatchObject({ offsetX: 20, offsetY: 20 });
  });

  it('PSD effects round-trip unchanged and legacy lyEf blocks are migrated', () => {
    expect(parsePsdEffects(serializePsdEffects(effects))).toEqual(effects);
    expect(parsePsdEffects(JSON.stringify(effects)).dropShadow).toMatchObject({ offsetX: 8, offsetY: 8 });
    expect(parsePsdEffects('not json')).toBe(DEFAULT_EFFECTS);
    expect(parsePsdEffects(undefined)).toBe(DEFAULT_EFFECTS);
  });
});
