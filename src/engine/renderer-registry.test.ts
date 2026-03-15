import { describe, it, expect } from 'vitest';
import { getRenderer, isGPUAccelerated } from './renderer-registry';

describe('renderer-registry', () => {
  it('defaults to canvas2d renderer', () => {
    const renderer = getRenderer();
    expect(renderer.type).toBe('canvas2d');
  });

  it('reports not GPU-accelerated by default', () => {
    expect(isGPUAccelerated()).toBe(false);
  });

  it('getRenderer returns a valid RenderDriver', () => {
    const renderer = getRenderer();
    expect(typeof renderer.supportsBlendMode).toBe('function');
    expect(typeof renderer.dispose).toBe('function');
  });
});
