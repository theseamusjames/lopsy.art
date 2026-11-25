import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import {
  HDR_FORMATS,
  HDR_FORMAT_WORDS,
  fitExportChoices,
  fixedColorWords,
  hdrUnavailableReason,
  locationKept,
  offeredColorSpaces,
  sizeChoicesFor,
} from './export-form';
import { DEFAULT_EXTRAS } from './export-size';

describe('export form', () => {
  it('offers Rec. 2020 for the 16-bit files only', () => {
    expect(offeredColorSpaces('tiff')).toEqual(['srgb', 'display-p3', 'rec2020']);
    expect(offeredColorSpaces('png', 16)).toEqual(['srgb', 'display-p3', 'rec2020']);
    expect(offeredColorSpaces('png', 8)).toEqual(['srgb', 'display-p3']);
    expect(offeredColorSpaces('jpeg')).toEqual(['srgb', 'display-p3']);
  });

  it('says when the location will be kept', () => {
    expect(locationKept(DEFAULT_EXPORT_SETTINGS)).toBe(false);
    const keep = { ...DEFAULT_EXPORT_SETTINGS, metadata: 'all' as const, removeLocation: false };
    expect(locationKept(keep)).toBe(true);
    expect(locationKept({ ...keep, format: 'tiff' })).toBe(false);
    expect(locationKept({ ...keep, metadata: 'copyright' })).toBe(false);
  });
});

describe('HDR formats in the export form', () => {
  it('offers no choice of colours for an HDR file, and says what it is', () => {
    expect(offeredColorSpaces('hdr-png')).toEqual(['rec2020']);
    expect(offeredColorSpaces('hdr-jpeg')).toEqual(['srgb']);
    expect(fixedColorWords('hdr-png')).toBe('Rec. 2020, HDR (PQ)');
    expect(fixedColorWords('hdr-jpeg')).toBe('sRGB, with the HDR gain map');
    expect(fixedColorWords('jpeg')).toBeNull();
  });

  it('lists the gain-map JPEG first, each with words that promise nothing unchecked', () => {
    expect(HDR_FORMATS).toEqual(['hdr-jpeg', 'hdr-png']);
    expect(HDR_FORMAT_WORDS['hdr-jpeg'].label).toBe('HDR JPEG (gain map)');
    expect(HDR_FORMAT_WORDS['hdr-png'].label).toBe('HDR PNG (16-bit, PQ)');
    for (const format of HDR_FORMATS) expect(HDR_FORMAT_WORDS[format].help).toMatch(/designed|made for/);
  });

  it('says why HDR is not offered on the 8-bit fallback', () => {
    expect(hdrUnavailableReason(false)).toBeNull();
    expect(hdrUnavailableReason(true)).toMatch(/floating point/);
  });

  it('keeps the location for HDR files, which carry EXIF', () => {
    const keep = { ...DEFAULT_EXPORT_SETTINGS, metadata: 'all' as const, removeLocation: false };
    expect(locationKept({ ...keep, format: 'hdr-jpeg' })).toBe(true);
  });
});

describe('the size choices in the export form', () => {
  it('lets HDR files be made smaller, never larger, and keeps TIFF at full size', () => {
    expect(sizeChoicesFor('hdr-png', 'original')).toEqual({ canChoose: true, offersEnlarge: false, note: null });
    expect(sizeChoicesFor('hdr-jpeg', 'long')).toEqual({
      canChoose: true,
      offersEnlarge: false,
      note: 'HDR files are never enlarged: a photo smaller than this stays as it is.',
    });
    expect(sizeChoicesFor('jpeg', 'long')).toEqual({ canChoose: true, offersEnlarge: true, note: null });
    expect(sizeChoicesFor('jpeg', 'original')).toEqual({ canChoose: true, offersEnlarge: false, note: null });
    expect(sizeChoicesFor('tiff', 'long').canChoose).toBe(false);
  });

  it('keeps an HDR format at the size asked for, without enlarging', () => {
    const extras = { ...DEFAULT_EXTRAS, size: { mode: 'long' as const, px: 2000 }, allowEnlarge: true };
    const png = fitExportChoices({ ...DEFAULT_EXPORT_SETTINGS, format: 'hdr-png' }, extras);
    expect(png.extras).toMatchObject({ size: { mode: 'long', px: 2000 }, allowEnlarge: false });
    expect(png.settings).toMatchObject({ colorSpace: 'rec2020', maxLongEdge: 2000 });
    const jpeg = fitExportChoices({ ...DEFAULT_EXPORT_SETTINGS, format: 'hdr-jpeg' }, { ...extras, size: { mode: 'megapixels', mp: 12 } });
    expect(jpeg.extras).toMatchObject({ size: { mode: 'megapixels', mp: 12 }, allowEnlarge: false });
    expect(jpeg.settings.maxLongEdge).toBeNull();
    const tiff = fitExportChoices({ ...DEFAULT_EXPORT_SETTINGS, format: 'tiff' }, extras);
    expect(tiff.extras).toMatchObject({ size: { mode: 'original' }, allowEnlarge: false });
    expect(fitExportChoices({ ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg' }, extras).extras.allowEnlarge).toBe(true);
  });
});
