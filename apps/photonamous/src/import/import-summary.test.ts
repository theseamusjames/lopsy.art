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
