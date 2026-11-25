import { describe, expect, it } from 'vitest';
import { blobSize, canGradeLayer } from './grade-checks';
import { serializeLayer } from '../project-save';
import { deserializeLayer } from '../project-load';
import type { RasterLayer, TextLayer } from '../../types/layers';

const raster = {
  id: 'r',
  name: 'Sky',
  type: 'raster',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: {},
  mask: null,
  width: 4,
  height: 2,
} as unknown as RasterLayer;

describe('grade checks', () => {
  it('grades only unlocked raster layers', () => {
    expect(canGradeLayer(raster)).toBe(true);
    expect(canGradeLayer({ ...raster, locked: true })).toBe(false);
    expect(canGradeLayer({ ...raster, type: 'text' } as unknown as TextLayer)).toBe(false);
    expect(canGradeLayer(undefined)).toBe(false);
  });

  it('reads the full size from a 16-bit blob header', () => {
    const blob = new Uint8Array(32);
    const view = new DataView(blob.buffer);
    [1, 2, 3, 4, 640, 480].forEach((v, i) => view.setInt32(i * 4, v, true));
    expect(blobSize(blob)).toEqual({ width: 640, height: 480 });
    expect(blobSize(new Uint8Array(10))).toBeNull();
  });
});

describe('the grade recipe in .lopsy files', () => {
  it('round-trips on a raster layer and is absent otherwise', () => {
    const recipe = { tone: { exposure: 0.5 }, profile: { id: 'standard' } };
    const saved = serializeLayer({ ...raster, gradeRecipe: recipe }, 0, -1, 4, 2);
    expect(saved.gradeRecipe).toEqual(recipe);
    expect((deserializeLayer(saved) as RasterLayer).gradeRecipe).toEqual(recipe);
    const plain = serializeLayer(raster, 0, -1, 4, 2);
    expect('gradeRecipe' in plain).toBe(false);
    expect('gradeRecipe' in deserializeLayer(plain)).toBe(false);
  });
});
