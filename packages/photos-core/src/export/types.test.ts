import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, colorSpacesFor, exportSettingsFromJson, exportSettingsProblem } from './types';

describe('export colour spaces', () => {
  it('offers Rec. 2020 for 16-bit files only: TIFF, and PNG at 16 bits', () => {
    expect(colorSpacesFor('tiff')).toEqual(['srgb', 'display-p3', 'rec2020']);
    expect(colorSpacesFor('png')).toEqual(['srgb', 'display-p3', 'rec2020']);
    expect(colorSpacesFor('png', 8)).toEqual(['srgb', 'display-p3']);
    expect(colorSpacesFor('jpeg')).toEqual(['srgb', 'display-p3']);
  });

  it('says why an 8-bit file cannot be Rec. 2020', () => {
    expect(exportSettingsProblem({ ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', colorSpace: 'rec2020' })).toMatch(/16-bit/);
    expect(exportSettingsProblem({ ...DEFAULT_EXPORT_SETTINGS, format: 'png', pngDepth: 8, colorSpace: 'rec2020' })).toMatch(/16-bit/);
    expect(exportSettingsProblem({ ...DEFAULT_EXPORT_SETTINGS, format: 'tiff', colorSpace: 'rec2020' })).toBeNull();
    expect(exportSettingsProblem({ ...DEFAULT_EXPORT_SETTINGS, format: 'png', pngDepth: 16, colorSpace: 'rec2020', maxLongEdge: null, size: { mode: 'original' } })).toBeNull();
  });

  it('makes a Rec. 2020 PNG at the original size only', () => {
    const png = { ...DEFAULT_EXPORT_SETTINGS, format: 'png' as const, pngDepth: 16 as const, colorSpace: 'rec2020' as const };
    expect(exportSettingsProblem({ ...png, maxLongEdge: 2048, size: { mode: 'long', px: 2048 } })).toMatch(/original size/);
    expect(exportSettingsProblem({ ...png, maxLongEdge: null, size: { mode: 'megapixels', mp: 12 } })).toMatch(/original size/);
  });

  it('keeps a stored Rec. 2020 choice only where the file can carry it', () => {
    expect(exportSettingsFromJson({ format: 'png', colorSpace: 'rec2020' }).colorSpace).toBe('rec2020');
    expect(exportSettingsFromJson({ format: 'png', pngDepth: 8, colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
    expect(exportSettingsFromJson({ format: 'jpeg', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
  });
});
