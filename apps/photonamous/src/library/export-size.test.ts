import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, exportSettingsFromJson } from '@lopsy/photos-core/export/types';
import { DEFAULT_EXTRAS, extrasOf, maxLongEdgeOf, outputSize, parseExtras, presetExtras, withExtras } from './export-size';

const image = { width: 6000, height: 4000 };

describe('export size', () => {
  it('sizes by long edge, short edge and megapixels', () => {
    expect(outputSize(image, { size: { mode: 'original' }, allowEnlarge: false })).toBe(image);
    expect(outputSize(image, { size: { mode: 'long', px: 3000 }, allowEnlarge: false })).toEqual({ width: 3000, height: 2000 });
    expect(outputSize(image, { size: { mode: 'short', px: 1000 }, allowEnlarge: false })).toEqual({ width: 1500, height: 1000 });
    expect(outputSize(image, { size: { mode: 'megapixels', mp: 6 }, allowEnlarge: false })).toEqual({ width: 3000, height: 2000 });
  });

  it('enlarges only when allowed', () => {
    expect(outputSize(image, { size: { mode: 'long', px: 12000 }, allowEnlarge: false })).toBe(image);
    expect(outputSize(image, { size: { mode: 'long', px: 12000 }, allowEnlarge: true })).toEqual({ width: 12000, height: 8000 });
  });

  it('rides along with the settings and reads back safely', () => {
    const extras = { ...DEFAULT_EXTRAS, size: { mode: 'short' as const, px: 1080 }, pngDepth: 8 as const, zip: false };
    const settings = { ...DEFAULT_EXPORT_SETTINGS, ...withExtras(DEFAULT_EXPORT_SETTINGS, extras) };
    expect(extrasOf(settings)).toEqual(extras);
    expect(extrasOf(DEFAULT_EXPORT_SETTINGS)).toEqual(DEFAULT_EXTRAS);
    expect(parseExtras({ size: { mode: 'long', px: -3 }, pngDepth: 12 })).toEqual(DEFAULT_EXTRAS);
    expect(parseExtras(JSON.parse(JSON.stringify(extras)))).toEqual(extras);
  });

  it('maps a long edge both ways for photos-core and built-in presets', () => {
    expect(maxLongEdgeOf({ ...DEFAULT_EXTRAS, size: { mode: 'long', px: 2048 } })).toBe(2048);
    expect(maxLongEdgeOf({ ...DEFAULT_EXTRAS, size: { mode: 'short', px: 2048 } })).toBeNull();
    // A preset saved before the size fields: its long edge is its size.
    expect(extrasOf(exportSettingsFromJson({ format: 'jpeg', maxLongEdge: 2048 })).size).toEqual({ mode: 'long', px: 2048 });
  });

  it('are real settings fields that survive a saved preset, and read old presets from their setting', () => {
    const extras = { ...DEFAULT_EXTRAS, size: { mode: 'megapixels' as const, mp: 12 }, allowEnlarge: true, pngDepth: 8 as const, zip: false };
    const saved = exportSettingsFromJson(JSON.parse(JSON.stringify(withExtras({ ...DEFAULT_EXPORT_SETTINGS, format: 'png' as const }, extras))));
    expect(saved).toMatchObject({ size: { mode: 'megapixels', mp: 12 }, allowEnlarge: true, pngDepth: 8, zip: false, maxLongEdge: null });
    expect(presetExtras(saved, undefined)).toEqual(extras);
    const legacy = { size: { mode: 'short', px: 1080 }, allowEnlarge: false, pngDepth: 16, zip: true };
    expect(presetExtras(exportSettingsFromJson({ format: 'jpeg' }), legacy).size).toEqual({ mode: 'short', px: 1080 });
  });
});
