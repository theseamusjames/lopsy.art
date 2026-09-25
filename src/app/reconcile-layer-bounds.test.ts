import { describe, it, expect } from 'vitest';
import { boundsPatchForEngine } from './reconcile-layer-bounds';
import { createRasterLayer, createTextLayer, createGroupLayer } from '../layers/layer-model';

function raster(x: number, y: number, width: number, height: number) {
  return { ...createRasterLayer({ name: 'L', width, height }), x, y };
}

describe('boundsPatchForEngine', () => {
  it('is null when store and engine agree', () => {
    expect(boundsPatchForEngine(raster(360, 90, 120, 120), { x: 360, y: 90, width: 120, height: 120 })).toBeNull();
  });

  // #810: a pre-float expanded the engine texture to the document while the
  // store kept the cropped rect.
  it('copies position and size for a raster layer the engine expanded', () => {
    expect(boundsPatchForEngine(raster(360, 90, 120, 120), { x: 0, y: 0, width: 600, height: 400 }))
      .toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  it('copies only the fields that differ', () => {
    expect(boundsPatchForEngine(raster(0, 0, 120, 120), { x: 0, y: 0, width: 600, height: 400 }))
      .toEqual({ width: 600, height: 400 });
  });

  it('includes off-canvas origins from a grown float', () => {
    expect(boundsPatchForEngine(raster(0, 0, 400, 300), { x: 0, y: 0, width: 400, height: 361 }))
      .toEqual({ height: 361 });
  });

  it('moves a text layer but leaves its size alone', () => {
    const text = { ...createTextLayer({ name: 'T', text: 'hi' }), x: 10, y: 20 };
    expect(boundsPatchForEngine(text, { x: 0, y: 0, width: 600, height: 400 })).toEqual({ x: 0, y: 0 });
  });

  it('ignores groups and texture-less layers', () => {
    expect(boundsPatchForEngine(createGroupLayer({ name: 'G' }), { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
    expect(boundsPatchForEngine(raster(5, 5, 10, 10), { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });
});
