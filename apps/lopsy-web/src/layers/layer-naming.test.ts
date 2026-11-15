import { describe, it, expect } from 'vitest';
import { nextDefaultLayerName } from './layer-naming';
import { createGroupLayer, createRasterLayer } from './layer-model';

function raster(name: string) {
  return createRasterLayer({ name, width: 1, height: 1 });
}

describe('nextDefaultLayerName', () => {
  it('starts at 1 when no layer uses the prefix', () => {
    expect(nextDefaultLayerName([raster('Background')], 'Layer')).toBe('Layer 1');
  });

  it('ignores groups and other names when numbering', () => {
    const layers = [raster('Background'), raster('Layer 1'), createGroupLayer({ name: 'Project' })];
    expect(nextDefaultLayerName(layers, 'Layer')).toBe('Layer 2');
  });

  it('never reuses a name after a lower-numbered layer is deleted', () => {
    const layers = [raster('Background'), raster('Layer 2')];
    expect(nextDefaultLayerName(layers, 'Layer')).toBe('Layer 3');
  });

  it('only matches the exact "<prefix> <n>" form', () => {
    const layers = [raster('Layer 9 copy'), raster('My Layer 7'), raster('Layer 3')];
    expect(nextDefaultLayerName(layers, 'Layer')).toBe('Layer 4');
  });

  it('works for other prefixes', () => {
    expect(nextDefaultLayerName([raster('Text 4'), raster('Layer 8')], 'Text')).toBe('Text 5');
  });
});
