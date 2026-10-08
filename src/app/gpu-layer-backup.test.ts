import { describe, it, expect } from 'vitest';
import { layerForBackup } from './gpu-layer-backup';
import type { RasterLayer, TextLayer } from '../types';

describe('layerForBackup (#1088)', () => {
  const base = {
    id: 'l1', name: 'L', visible: true, locked: false, opacity: 1, blendMode: 'normal',
    x: 10, y: 20, clipToBelow: false, effects: {}, mask: null,
  } as const;
  const raster = { ...base, type: 'raster', width: 100, height: 50 } as unknown as RasterLayer;
  const text = { ...base, type: 'text', text: 'HELLO', fontSize: 40, width: null } as unknown as TextLayer;

  it('puts a moved raster layer back at the geometry its pixels had', () => {
    const moved = { ...raster, x: 300, y: 5, opacity: 0.5 };
    expect(layerForBackup(moved, { blob: null, layer: raster })).toEqual({ ...moved, x: 10, y: 20 });
  });

  it('keeps an unchanged raster layer as is', () => {
    expect(layerForBackup(raster, { blob: null, layer: raster })).toBe(raster);
  });

  it('pairs a text layer with the model its glyphs were rendered from', () => {
    const edited = { ...text, text: 'HELLO WORLD', x: 0, y: 0 };
    expect(layerForBackup(edited, { blob: null, layer: text })).toBe(text);
  });

  it('leaves a layer whose type changed since the backup alone', () => {
    const rasterized = { ...raster, x: 1 };
    expect(layerForBackup(rasterized, { blob: null, layer: text })).toBe(rasterized);
  });
});
