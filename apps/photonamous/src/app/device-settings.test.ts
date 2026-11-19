import { describe, expect, it } from 'vitest';
import { describeHealth, parseDriveAddMode } from './device-settings';

const clean = { assetsChecked: 3, missing: [], trashed: [], changed: [], orphans: [] };

describe('device settings', () => {
  it('moves added Drive files unless told to leave them', () => {
    expect(parseDriveAddMode(null)).toBe('move');
    expect(parseDriveAddMode('leave')).toBe('leave');
    expect(parseDriveAddMode('junk')).toBe('move');
  });

  it('describes a library check', () => {
    expect(describeHealth(clean)).toEqual(['All 3 originals are where they should be.']);
    expect(describeHealth({ ...clean, missing: ['a'], trashed: ['b', 'c'], orphans: ['f'] })).toEqual([
      '1 original is missing from storage.',
      '2 originals are in the trash.',
      '1 photo is in Originals but not in the library.',
    ]);
    expect(describeHealth({ ...clean, leftovers: ['x', 'y'] })).toEqual(['2 originals of deleted photos are still outside the trash.']);
  });
});
