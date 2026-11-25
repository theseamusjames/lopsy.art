import { describe, expect, it } from 'vitest';
import { countWords, isReduced, sizeWords } from './status-text';

describe('status bar words', () => {
  it('counts with the right noun and thousands grouped', () => {
    expect(countWords(1, 'photo')).toBe('1 photo');
    expect(countWords(0, 'photo')).toBe('0 photos');
    expect(countWords(1234, 'photo')).toBe('1,234 photos');
  });

  it('writes a size as width by height in pixels', () => {
    expect(sizeWords({ width: 6240, height: 4160 })).toBe('6240 × 4160 px');
  });

  it('tells a reduced working image from a full-size one', () => {
    expect(isReduced({ photo: { width: 6240, height: 4160 }, working: { width: 3072, height: 2048 } })).toBe(true);
    expect(isReduced({ photo: { width: 800, height: 600 }, working: { width: 800, height: 600 } })).toBe(false);
  });
});
