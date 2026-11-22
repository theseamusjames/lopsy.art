import { describe, expect, it } from 'vitest';
import { formatZoom, parseZoomText } from './zoom-text';

describe('formatZoom', () => {
  it('shows a whole percentage', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.366)).toBe('37%');
  });
});

describe('parseZoomText', () => {
  it('reads a level with or without its sign', () => {
    expect(parseZoomText('70', 0.1, 4)).toBeCloseTo(0.7);
    expect(parseZoomText(' 70 % ', 0.1, 4)).toBeCloseTo(0.7);
    expect(parseZoomText('62.5%', 0.1, 4)).toBeCloseTo(0.625);
    expect(parseZoomText('62,5', 0.1, 4)).toBeCloseTo(0.625);
  });

  it('holds the level within the range', () => {
    expect(parseZoomText('1000', 0.1, 4)).toBe(4);
    expect(parseZoomText('3', 0.1, 4)).toBe(0.1);
  });

  it('refuses what is not a level', () => {
    expect(parseZoomText('', 0.1, 4)).toBeNull();
    expect(parseZoomText('big', 0.1, 4)).toBeNull();
    expect(parseZoomText('-50', 0.1, 4)).toBeNull();
    expect(parseZoomText('0', 0.1, 4)).toBeNull();
    expect(parseZoomText('50%%', 0.1, 4)).toBeNull();
  });
});
