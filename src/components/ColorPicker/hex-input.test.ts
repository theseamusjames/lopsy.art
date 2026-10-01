import { describe, it, expect } from 'vitest';
import { parseHexInput, formatHexInput } from './hex-input';

describe('parseHexInput', () => {
  it('parses six digits with or without #', () => {
    expect(parseHexInput('3B1463')).toEqual({ r: 0x3b, g: 0x14, b: 0x63 });
    expect(parseHexInput('#3B1463')).toEqual({ r: 0x3b, g: 0x14, b: 0x63 });
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(parseHexInput('  #3b1463 ')).toEqual({ r: 0x3b, g: 0x14, b: 0x63 });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHexInput('f80')).toEqual({ r: 0xff, g: 0x88, b: 0x00 });
    expect(parseHexInput('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('rejects anything that is not 3 or 6 hex digits', () => {
    expect(parseHexInput('')).toBeNull();
    expect(parseHexInput('#')).toBeNull();
    expect(parseHexInput('12345')).toBeNull();
    expect(parseHexInput('12345g')).toBeNull();
    expect(parseHexInput('zzz')).toBeNull();
    expect(parseHexInput('##123456')).toBeNull();
    expect(parseHexInput('3B146380')).toBeNull();
    expect(parseHexInput('rgb(1,2,3)')).toBeNull();
  });
});

describe('formatHexInput', () => {
  it('formats six uppercase digits without #', () => {
    expect(formatHexInput({ r: 0x3b, g: 0x14, b: 0x63, a: 0.5 })).toBe('3B1463');
    expect(formatHexInput({ r: 0, g: 0, b: 0, a: 1 })).toBe('000000');
  });
});
