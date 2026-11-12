import { describe, it, expect } from 'vitest';
import { getMaskDocOrigin, getMasksMovedWithLayers, getNewMaskSize } from './mask-origin';
import { createRasterLayer, createTextLayer, createGroupLayer } from './layer-model';
import type { Layer } from '../types';

describe('getMaskDocOrigin', () => {
  it('anchors a raster mask at the document origin even when the layer is offset', () => {
    const layer = { ...createRasterLayer({ name: 'r', width: 400, height: 90 }), x: 650, y: 340 } as Layer;
    expect(getMaskDocOrigin(layer)).toEqual({ x: 0, y: 0 });
  });

  it('anchors a group mask at the document origin', () => {
    const layer = { ...createGroupLayer({ name: 'g' }), x: 10, y: 20 } as Layer;
    expect(getMaskDocOrigin(layer)).toEqual({ x: 0, y: 0 });
  });

  it('tracks a text layer position', () => {
    const layer = { ...createTextLayer({ name: 't', text: 'hi' }), x: 12, y: 34 } as Layer;
    expect(getMaskDocOrigin(layer)).toEqual({ x: 12, y: 34 });
  });
});

describe('getNewMaskSize', () => {
  it('sizes a raster mask to the document, not the cropped layer box', () => {
    const layer = { ...createRasterLayer({ name: 'r', width: 400, height: 90 }), x: 650, y: 340 } as Layer;
    expect(getNewMaskSize(layer, 1200, 600)).toEqual({ width: 1200, height: 600 });
  });

  it('sizes a text mask to the document', () => {
    const layer = createTextLayer({ name: 't', text: 'hi' });
    expect(getNewMaskSize(layer, 300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe('getMasksMovedWithLayers (#1504)', () => {
  // Only the presence of a mask matters here; the bytes are never read.
  const mask = { id: 'm', enabled: true, data: {} as Uint8ClampedArray, width: 2, height: 2 };
  const withMask = <T extends Layer>(l: T): T => ({ ...l, mask }) as T;

  it('returns the moved raster layer when it has a mask', () => {
    const masked = withMask(createRasterLayer({ name: 'a', width: 2, height: 2 }));
    const bare = createRasterLayer({ name: 'b', width: 2, height: 2 });
    expect(getMasksMovedWithLayers([masked, bare], [masked.id, bare.id])).toEqual([masked.id]);
  });

  it('includes masked descendants of a moved group, and the group itself', () => {
    const child = withMask(createRasterLayer({ name: 'c', width: 2, height: 2 }));
    const inner = withMask(createGroupLayer({ name: 'inner', children: [child.id] }));
    const outer = withMask(createGroupLayer({ name: 'outer', children: [inner.id] }));
    const other = withMask(createRasterLayer({ name: 'o', width: 2, height: 2 }));
    const ids = getMasksMovedWithLayers([child, inner, outer, other], [outer.id]);
    expect(ids.sort()).toEqual([child.id, inner.id, outer.id].sort());
  });

  it('skips text masks, which already track the layer position', () => {
    const text = withMask(createTextLayer({ name: 't', text: 'hi' }));
    expect(getMasksMovedWithLayers([text], [text.id])).toEqual([]);
  });
});
