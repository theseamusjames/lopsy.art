import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  colorSpacesFor,
  containerOf,
  exportSettingsFromJson,
  exportSettingsProblem,
  isAlwaysFullSize,
  isHdrFormat,
  isSixteenBit,
  mimeTypeFor,
  usesQuality,
} from './types';

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

describe('HDR export formats', () => {
  it('has one colour space each and no choice', () => {
    expect(colorSpacesFor('hdr-png')).toEqual(['rec2020']);
    expect(colorSpacesFor('hdr-jpeg')).toEqual(['srgb']);
  });

  it('names what each is and how it is written', () => {
    expect(isHdrFormat('hdr-png')).toBe(true);
    expect(isHdrFormat('hdr-jpeg')).toBe(true);
    expect(isHdrFormat('png')).toBe(false);
    expect(mimeTypeFor('hdr-png')).toBe('image/png');
    expect(mimeTypeFor('hdr-jpeg')).toBe('image/jpeg');
    expect(containerOf('hdr-png')).toBe('png');
    expect(containerOf('hdr-jpeg')).toBe('jpeg');
    expect(isSixteenBit('hdr-png')).toBe(true);
    expect(isAlwaysFullSize('hdr-jpeg')).toBe(true);
    expect(isAlwaysFullSize('jpeg')).toBe(false);
    expect(usesQuality('hdr-jpeg')).toBe(true);
    expect(usesQuality('hdr-png')).toBe(false);
  });

  it('makes HDR files at the original size, in their own space', () => {
    const base = { ...DEFAULT_EXPORT_SETTINGS, format: 'hdr-png' as const, colorSpace: 'rec2020' as const };
    expect(exportSettingsProblem(base)).toBeNull();
    expect(exportSettingsProblem({ ...base, size: { mode: 'long', px: 2048 } })).toBe('HDR files are made at the original size.');
    expect(exportSettingsProblem({ ...base, colorSpace: 'srgb' })).toBe('An HDR PNG is always Rec. 2020.');
    expect(exportSettingsProblem({ ...base, format: 'hdr-jpeg', colorSpace: 'display-p3' })).toBe('An HDR JPEG’s picture is always sRGB.');
  });

  it('reads a stored HDR preset back at full size in its own space', () => {
    const png = exportSettingsFromJson({ format: 'hdr-png', colorSpace: 'srgb', maxLongEdge: 2048, size: { mode: 'long', px: 2048 } });
    expect(png).toMatchObject({ format: 'hdr-png', colorSpace: 'rec2020', maxLongEdge: null, size: { mode: 'original' } });
    expect(exportSettingsProblem(png)).toBeNull();
    expect(exportSettingsFromJson({ format: 'hdr-jpeg' })).toMatchObject({ format: 'hdr-jpeg', colorSpace: 'srgb' });
  });
});
