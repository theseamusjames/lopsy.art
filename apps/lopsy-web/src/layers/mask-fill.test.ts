import { describe, it, expect } from 'vitest';
import { maskValueForColor } from './mask-fill';

describe('maskValueForColor', () => {
  it('maps black to hide, white to reveal and colours to their luminance', () => {
    expect(maskValueForColor({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(maskValueForColor({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(maskValueForColor({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.299, 6);
  });
});
