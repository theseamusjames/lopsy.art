import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  canEnlarge,
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
    expect(isAlwaysFullSize('hdr-jpeg')).toBe(false);
    expect(isAlwaysFullSize('hdr-png')).toBe(false);
    expect(isAlwaysFullSize('tiff')).toBe(true);
    expect(isAlwaysFullSize('jpeg')).toBe(false);
    expect(canEnlarge('hdr-jpeg')).toBe(false);
    expect(canEnlarge('hdr-png')).toBe(false);
    expect(canEnlarge('tiff')).toBe(false);
    expect(canEnlarge('jpeg')).toBe(true);
    expect(canEnlarge('png')).toBe(true);
    expect(usesQuality('hdr-jpeg')).toBe(true);
    expect(usesQuality('hdr-png')).toBe(false);
  });

  it('makes HDR files at a chosen size, never enlarged, in their own space', () => {
    const base = { ...DEFAULT_EXPORT_SETTINGS, format: 'hdr-png' as const, colorSpace: 'rec2020' as const };
    expect(exportSettingsProblem(base)).toBeNull();
    expect(exportSettingsProblem({ ...base, size: { mode: 'long', px: 2048 }, maxLongEdge: 2048 })).toBeNull();
    expect(exportSettingsProblem({ ...base, size: { mode: 'short', px: 1080 } })).toBeNull();
    expect(exportSettingsProblem({ ...base, format: 'hdr-jpeg', colorSpace: 'srgb', size: { mode: 'megapixels', mp: 12 } })).toBeNull();
    expect(exportSettingsProblem({ ...base, size: { mode: 'long', px: 2048 }, allowEnlarge: true })).toBe('HDR files are never made larger than the photo.');
    expect(exportSettingsProblem({ ...base, colorSpace: 'srgb' })).toBe('An HDR PNG is always Rec. 2020.');
    expect(exportSettingsProblem({ ...base, format: 'hdr-jpeg', colorSpace: 'display-p3' })).toBe('An HDR JPEG’s picture is always sRGB.');
  });

  it('reads a stored HDR preset back at its size, never enlarged, in its own space', () => {
    const png = exportSettingsFromJson({ format: 'hdr-png', colorSpace: 'srgb', maxLongEdge: 2048, size: { mode: 'long', px: 2048 }, allowEnlarge: true });
    expect(png).toMatchObject({ format: 'hdr-png', colorSpace: 'rec2020', maxLongEdge: 2048, size: { mode: 'long', px: 2048 }, allowEnlarge: false });
    expect(exportSettingsProblem(png)).toBeNull();
    expect(exportSettingsFromJson({ format: 'hdr-jpeg' })).toMatchObject({ format: 'hdr-jpeg', colorSpace: 'srgb' });
  });
});
