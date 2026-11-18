import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { locationKept, offeredColorSpaces } from './export-form';

describe('export form', () => {
  it('offers what the engine encodes: no Rec. 2020 yet, even for TIFF', () => {
    expect(offeredColorSpaces('tiff')).toEqual(['srgb', 'display-p3']);
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
