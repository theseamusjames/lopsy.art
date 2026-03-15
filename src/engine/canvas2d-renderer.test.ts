import { describe, it, expect } from 'vitest';
import { Canvas2DRenderer } from './canvas2d-renderer';

describe('Canvas2DRenderer', () => {
  it('reports type as canvas2d', () => {
    const renderer = new Canvas2DRenderer();
    expect(renderer.type).toBe('canvas2d');
  });

  it('supports the 7 implemented blend modes', () => {
    const renderer = new Canvas2DRenderer();
    const supported = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] as const;
    for (const mode of supported) {
      expect(renderer.supportsBlendMode(mode)).toBe(true);
    }
  });

  it('does not support unimplemented blend modes', () => {
    const renderer = new Canvas2DRenderer();
    const unsupported = [
      'color-dodge', 'color-burn', 'hard-light', 'soft-light',
      'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    ] as const;
    for (const mode of unsupported) {
      expect(renderer.supportsBlendMode(mode)).toBe(false);
    }
  });

  it('dispose does not throw', () => {
    const renderer = new Canvas2DRenderer();
    expect(() => renderer.dispose()).not.toThrow();
  });
});
