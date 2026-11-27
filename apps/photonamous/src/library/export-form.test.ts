import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import {
  HDR_FORMATS,
  HDR_FORMAT_WORDS,
  deviceSizeNote,
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

describe('deviceSizeNote', () => {
  const q2 = { width: 8368, height: 5584 };
  const small = { width: 6000, height: 4000 };

  it('names the largest size this device can export of one photo larger than its textures', () => {
    expect(deviceSizeNote([q2], 8192, 'jpeg', DEFAULT_EXTRAS)).toBe(
      'This photo is 8368 × 5584 pixels, more than this device’s graphics can edit (8190 on a side). ' +
        'The largest this device can export of it is 8190 × 5465, a crop smaller in proportion.',
    );
    expect(deviceSizeNote([q2], 8192, 'tiff', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 2048 } })).toContain('8190 × 5465');
  });

  it('says nothing when the photos fit, the size asked for fits, or the limit is unknown', () => {
    expect(deviceSizeNote([small], 8192, 'jpeg', DEFAULT_EXTRAS)).toBeNull();
    expect(deviceSizeNote([q2], 16384, 'png', DEFAULT_EXTRAS)).toBeNull();
    expect(deviceSizeNote([q2], 8192, 'jpeg', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 4096 } })).toBeNull();
    expect(deviceSizeNote([q2], null, 'jpeg', DEFAULT_EXTRAS)).toBeNull();
    expect(deviceSizeNote([null], 8192, 'jpeg', DEFAULT_EXTRAS)).toBeNull();
  });

  it('says a photo larger than the textures is exported a part at a time where the engine makes tiles', () => {
    expect(deviceSizeNote([q2], 8192, 'jpeg', DEFAULT_EXTRAS, true)).toBe(
      'This photo is 8368 × 5584 pixels, more than this device’s graphics can edit at once (8190 on a side). It is exported at its full size, a part at a time.',
    );
    expect(deviceSizeNote([q2], 8192, 'png', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 8300 } }, true)).toBe(
      'This photo is 8368 × 5584 pixels, more than this device’s graphics can edit at once (8190 on a side). It is exported a part at a time.',
    );
    expect(deviceSizeNote([q2], 8192, 'tiff', DEFAULT_EXTRAS, true)).toContain('at its full size, a part at a time');
    expect(deviceSizeNote([q2], 8192, 'hdr-png', DEFAULT_EXTRAS, true)).toContain('at its full size, a part at a time');
    expect(deviceSizeNote([q2], 8192, 'hdr-jpeg', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 8300 } }, true)).toContain(
      'An HDR file is made a part at a time only at its full size; smaller, the largest this device can make is 8190 × 5465.',
    );
    expect(deviceSizeNote([q2, { width: 9000, height: 6000 }], 8192, 'jpeg', DEFAULT_EXTRAS, true)).toBe(
      '2 of these photos are more than this device’s graphics can edit at once (8190 pixels on a side), so each is exported a part at a time.',
    );
    expect(deviceSizeNote([q2], 8192, 'jpeg', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 4096 } }, true)).toBeNull();
  });

  it('counts the photos it affects among several, and says an enlargement is made from the largest size', () => {
    const note = deviceSizeNote([q2, small, { width: 9000, height: 6000 }], 8192, 'png', { ...DEFAULT_EXTRAS, size: { mode: 'long', px: 9000 }, allowEnlarge: true });
    expect(note).toBe(
      '2 of these photos are more than this device’s graphics can edit (8190 pixels on a side), so each is exported at most 8190 pixels on its long edge, ' +
        'a crop smaller in proportion. Larger sizes are enlarged from that.',
    );
  });
});
