import { describe, it, expect } from 'vitest';
import { isotropicScale, scaleLayerEffects, scaleTextLayerForResize } from './layer-transform';
import { createTextLayer, DEFAULT_EFFECTS } from '../../../../layers/layer-model';
import type { LayerEffects } from '../../../../types';

const effectsWithValues: LayerEffects = {
  stroke: { ...DEFAULT_EFFECTS.stroke, width: 10 },
  dropShadow: { ...DEFAULT_EFFECTS.dropShadow, offsetX: 4, offsetY: 8, blur: 12, spread: 2 },
  outerGlow: { ...DEFAULT_EFFECTS.outerGlow, size: 20, spread: 4 },
  innerGlow: { ...DEFAULT_EFFECTS.innerGlow, size: 6, spread: 1 },
  colorOverlay: { ...DEFAULT_EFFECTS.colorOverlay },
};

describe('isotropicScale', () => {
  it('returns the shared factor for a uniform scale', () => {
    expect(isotropicScale(2, 2)).toBe(2);
  });

  it('returns the geometric mean for a non-uniform scale', () => {
    expect(isotropicScale(4, 1)).toBe(2);
  });
});

describe('scaleLayerEffects', () => {
  it('scales all size fields uniformly under a uniform scale', () => {
    const scaled = scaleLayerEffects(effectsWithValues, 2, 2);
    expect(scaled.stroke.width).toBe(20);
    expect(scaled.dropShadow.offsetX).toBe(8);
    expect(scaled.dropShadow.offsetY).toBe(16);
    expect(scaled.dropShadow.blur).toBe(24);
    expect(scaled.dropShadow.spread).toBe(4);
    expect(scaled.outerGlow.size).toBe(40);
    expect(scaled.outerGlow.spread).toBe(8);
    expect(scaled.innerGlow.size).toBe(12);
    expect(scaled.innerGlow.spread).toBe(2);
  });

  it('scales directional offsets by their own axis but axis-less fields by the geometric mean under non-uniform scale', () => {
    const scaled = scaleLayerEffects(effectsWithValues, 4, 1);
    // isotropicScale(4, 1) = 2
    expect(scaled.dropShadow.offsetX).toBe(16); // 4 * 4
    expect(scaled.dropShadow.offsetY).toBe(8); // 8 * 1
    expect(scaled.dropShadow.blur).toBe(24); // 12 * 2
    expect(scaled.stroke.width).toBe(20); // 10 * 2
    expect(scaled.outerGlow.size).toBe(40); // 20 * 2
  });

  it('leaves disabled/unrelated fields untouched', () => {
    const scaled = scaleLayerEffects(effectsWithValues, 2, 2);
    expect(scaled.stroke.enabled).toBe(effectsWithValues.stroke.enabled);
    expect(scaled.colorOverlay).toEqual(effectsWithValues.colorOverlay);
  });
});

describe('scaleTextLayerForResize', () => {
  it('scales position, fontSize, and letterSpacing by the geometric mean under uniform scale', () => {
    const layer = { ...createTextLayer({ name: 'Text', text: 'Hi', fontSize: 24 }), x: 4, y: 6, letterSpacing: 2 };
    const scaled = scaleTextLayerForResize(layer, 2, 2);
    expect(scaled.x).toBe(8);
    expect(scaled.y).toBe(12);
    expect(scaled.fontSize).toBe(48);
    expect(scaled.letterSpacing).toBe(4);
  });

  it('scales fontSize/letterSpacing by the geometric mean and area-text width by scaleX under non-uniform scale', () => {
    const layer = { ...createTextLayer({ name: 'Text', text: 'Hi', fontSize: 24 }), letterSpacing: 2, width: 100 };
    const scaled = scaleTextLayerForResize(layer, 4, 1);
    // isotropicScale(4, 1) = 2
    expect(scaled.fontSize).toBe(48);
    expect(scaled.letterSpacing).toBe(4);
    expect(scaled.width).toBe(400); // 100 * scaleX (4)
  });

  it('leaves a null (point-text) width as null', () => {
    const layer = createTextLayer({ name: 'Text', text: 'Hi' });
    expect(layer.width).toBeNull();
    const scaled = scaleTextLayerForResize(layer, 2, 3);
    expect(scaled.width).toBeNull();
  });

  it('scales the text layer effects too', () => {
    const layer = { ...createTextLayer({ name: 'Text', text: 'Hi' }), effects: effectsWithValues };
    const scaled = scaleTextLayerForResize(layer, 2, 2);
    expect(scaled.effects.stroke.width).toBe(20);
    expect(scaled.effects.dropShadow.blur).toBe(24);
  });
});
