import { describe, it, expect } from 'vitest';
import { getColorModeCapabilities } from './color-mode-capabilities';
import type { DocumentColorMode } from '../types/color-mode';

describe('getColorModeCapabilities', () => {
  it('grants every capability in RGB mode', () => {
    const caps = getColorModeCapabilities('rgb');
    expect(Object.values(caps).every(Boolean)).toBe(true);
  });

  it('drops color-space controls in every non-RGB mode', () => {
    for (const mode of ['grayscale', 'lab', 'cmyk', 'indexed'] as DocumentColorMode[]) {
      const caps = getColorModeCapabilities(mode);
      expect(caps.hasColorAdjustments).toBe(false);
      expect(caps.hasSaturation).toBe(false);
      expect(caps.hasCurveChannels).toBe(false);
      expect(caps.hasLevelChannels).toBe(false);
      // HSL blend modes decompose RGB, which no longer means anything.
      expect(caps.hasHslBlendModes).toBe(false);
    }
  });

  it('keeps the layer stack in grayscale and lab', () => {
    for (const mode of ['grayscale', 'lab'] as DocumentColorMode[]) {
      const caps = getColorModeCapabilities(mode);
      expect(caps.hasLayers).toBe(true);
      expect(caps.canAddLayers).toBe(true);
      expect(caps.hasGradients).toBe(true);
    }
  });

  it('makes CMYK a flat surface — ink spends the alpha channel on black', () => {
    const caps = getColorModeCapabilities('cmyk');
    expect(caps.hasLayers).toBe(false);
    expect(caps.canAddLayers).toBe(false);
    // Painting still works; there is just nowhere to composite a second layer.
    expect(caps.hasGradients).toBe(true);
    expect(caps.hasAntiAliasing).toBe(true);
  });

  it('locks indexed mode down to a flat palette-constrained surface', () => {
    const caps = getColorModeCapabilities('indexed');
    expect(caps.hasLayers).toBe(false);
    expect(caps.canAddLayers).toBe(false);
    expect(caps.hasGradients).toBe(false);
    expect(caps.hasAntiAliasing).toBe(false);
    expect(caps.hasColorAdjustments).toBe(false);
  });
});
