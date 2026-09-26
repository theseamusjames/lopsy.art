import { describe, it, expect } from 'vitest';
import { getMaskDocOrigin, getNewMaskSize } from './mask-origin';
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
