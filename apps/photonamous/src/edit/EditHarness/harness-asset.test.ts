import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { formatOf, harnessAsset, harnessVersion } from './harness-asset';

describe('formatOf', () => {
  it('reads the extension first, then the type', () => {
    expect(formatOf('DSCF0001.RAF', '')).toBe('raf');
    expect(formatOf('DSC06677.ARW', '')).toBe('arw');
    expect(formatOf('blob', 'image/x-sony-arw')).toBe('arw');
    expect(formatOf('IMG_0001.CR2', '')).toBe('cr2');
    expect(formatOf('blob', 'image/x-canon-cr2')).toBe('cr2');
    expect(formatOf('DSC_0001.NEF', '')).toBe('nef');
    expect(formatOf('blob', 'image/x-nikon-nef')).toBe('nef');
    // Not formats the Edit view opens: a CR3 and a COOLPIX NRW are refused by the engine.
    expect(formatOf('IMG_0001.CR3', 'image/x-canon-cr3')).toBeNull();
    expect(formatOf('DSCN0001.NRW', '')).toBeNull();
    expect(formatOf('photo.JPG', 'image/jpeg')).toBe('jpeg');
    expect(formatOf('blob', 'image/webp')).toBe('webp');
    expect(formatOf('notes.txt', 'text/plain')).toBeNull();
  });
});

describe('harness records', () => {
  it('links the version to the asset', () => {
    const asset = harnessAsset('a1', 'x.png', 10, 'png', 'image/png');
    const version = harnessVersion(asset);
    expect(version.id).toBe(asset.primaryVersionId);
    expect(version.assetId).toBe('a1');
    expect(version.recipe).toBe(DEFAULT_RECIPE);
  });
});
