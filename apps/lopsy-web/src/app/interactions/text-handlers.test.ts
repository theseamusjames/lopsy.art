import { describe, it, expect } from 'vitest';
import { hitTestTextLayer } from '../../tools/text/text-hit-test';
import { createTextLayer, createRasterLayer } from '../../layers/layer-model';
import type { Layer } from '../../types';

function makeTextLayer(overrides?: Partial<import('../../types').TextLayer>) {
  const base = createTextLayer({
    name: 'Test Text',
    text: 'Hello World',
    fontFamily: 'Inter',
    fontSize: 24,
  });
  return { ...base, x: 100, y: 200, visible: true, ...overrides };
}

describe('hitTestTextLayer', () => {
  it('returns text layer when clicking inside its bounds', () => {
    const textLayer = makeTextLayer();
    const layers: Layer[] = [
      createRasterLayer({ name: 'Background', width: 800, height: 600 }),
      textLayer,
    ];
    const result = hitTestTextLayer(layers, { x: 110, y: 210 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(textLayer.id);
  });

  it('returns null when clicking outside text layer bounds', () => {
    const textLayer = makeTextLayer();
    const layers: Layer[] = [textLayer];
    const result = hitTestTextLayer(layers, { x: 10, y: 10 });
    expect(result).toBeNull();
  });

  it('returns null when clicking below the text layer', () => {
    const textLayer = makeTextLayer();
    const layers: Layer[] = [textLayer];
    const result = hitTestTextLayer(layers, { x: 110, y: 400 });
    expect(result).toBeNull();
  });

  it('skips hidden text layers', () => {
    const textLayer = makeTextLayer({ visible: false });
    const layers: Layer[] = [textLayer];
    const result = hitTestTextLayer(layers, { x: 110, y: 210 });
    expect(result).toBeNull();
  });

  it('skips locked text layers', () => {
    const textLayer = makeTextLayer({ locked: true });
    const layers: Layer[] = [textLayer];
    const result = hitTestTextLayer(layers, { x: 110, y: 210 });
    expect(result).toBeNull();
  });

  it('returns topmost text layer when multiple overlap', () => {
    const textLayer1 = makeTextLayer({ x: 100, y: 200 });
    const textLayer2 = makeTextLayer({ x: 100, y: 200 });
    const layers: Layer[] = [textLayer1, textLayer2];
    const result = hitTestTextLayer(layers, { x: 110, y: 210 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(textLayer2.id);
  });

  it('ignores raster layers', () => {
    const layers: Layer[] = [
      createRasterLayer({ name: 'Background', width: 800, height: 600 }),
    ];
    const result = hitTestTextLayer(layers, { x: 50, y: 50 });
    expect(result).toBeNull();
  });

  it('handles area text with explicit width', () => {
    const textLayer = makeTextLayer({ width: 200, x: 100, y: 100 });
    const layers: Layer[] = [textLayer];
    // Inside the area (100 + 200 = 300)
    expect(hitTestTextLayer(layers, { x: 250, y: 110 })).not.toBeNull();
    // Outside the area
    expect(hitTestTextLayer(layers, { x: 350, y: 110 })).toBeNull();
  });

  it('returns null for empty layers array', () => {
    expect(hitTestTextLayer([], { x: 100, y: 100 })).toBeNull();
  });
});
