import { describe, expect, it } from 'vitest';
import { baseNameOf, formatBytes, plural, summarizeImport } from './import-summary';

describe('summarizeImport', () => {
  it('counts photos, skips other files and finds pairs', () => {
    const files = [
      { name: 'DSCF0001.RAF', size: 50_000_000 },
      { name: 'DSCF0001.JPG', size: 8_000_000 },
      { name: 'DSCF0002.RAF', size: 50_000_000 },
      { name: 'notes.txt', size: 100 },
      { name: 'cat.png', size: 1_000 },
    ];
    const s = summarizeImport(files);
    expect(s.photoCount).toBe(4);
    expect(s.totalBytes).toBe(108_001_000);
    expect(s.skippedNames).toEqual(['notes.txt']);
    expect(s.pairCount).toBe(1);
    expect(s.pairJpegBytes).toBe(8_000_000);
  });

  it('does not pair files from different folders', () => {
    const files = [
      { name: 'IMG_1.dng', size: 1 },
      { name: 'IMG_1.jpg', size: 1 },
    ];
    const paths = ['a/IMG_1.dng', 'b/IMG_1.jpg'];
    expect(summarizeImport(files, (i) => paths[i] ?? '').pairCount).toBe(0);
  });

  it('counts a Sony ARW as a photo, and as the RAW half of a pair', () => {
    const s = summarizeImport([
      { name: 'DSC06677.ARW', size: 40_000_000 },
      { name: 'DSC06677.JPG', size: 7_000_000 },
    ]);
    expect(s.photoCount).toBe(2);
    expect(s.skippedNames).toEqual([]);
    expect(s.pairCount).toBe(1);
    expect(s.pairJpegBytes).toBe(7_000_000);
  });
});

describe('Canon and Nikon RAW', () => {
  it('counts a Canon CR2 and a Nikon NEF as photos, each the RAW half of a pair', () => {
    const s = summarizeImport([
      { name: 'IMG_0001.CR2', size: 25_000_000 },
      { name: 'IMG_0001.JPG', size: 7_000_000 },
      { name: 'DSC_0002.NEF', size: 90_000_000 },
      { name: 'DSC_0002.jpg', size: 9_000_000 },
    ]);
    expect(s.photoCount).toBe(4);
    expect(s.skippedNames).toEqual([]);
    expect(s.pairCount).toBe(2);
  });

  it('leaves out a CR3 and a COOLPIX NRW, which the app does not read', () => {
    const s = summarizeImport([
      { name: 'IMG_0003.CR3', size: 30_000_000 },
      { name: 'DSCN0004.NRW', size: 30_000_000 },
    ]);
    expect(s.photoCount).toBe(0);
    expect(s.skippedNames).toEqual(['IMG_0003.CR3', 'DSCN0004.NRW']);
  });
});

describe('formatting', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
  });
  it('pluralises', () => {
    expect(plural(1, 'photo')).toBe('1 photo');
    expect(plural(50000, 'photo')).toBe('50,000 photos');
  });
  it('takes base names', () => {
    expect(baseNameOf('a/b/DSCF1.RAF')).toBe('dscf1');
  });
});
