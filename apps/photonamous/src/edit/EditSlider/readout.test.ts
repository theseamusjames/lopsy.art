import { describe, expect, it } from 'vitest';
import { decimalsOf, formatValue, parseValue, snap } from './readout';

const EV = { min: -5, max: 5, step: 0.01 };
const PCT = { min: -100, max: 100, step: 1 };

describe('decimalsOf', () => {
  it('counts the decimals of a step', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.01)).toBe(2);
    expect(decimalsOf(1e-7)).toBe(7);
  });
});

describe('snap', () => {
  it('clamps and rounds to the step', () => {
    expect(snap(0.304, EV)).toBe(0.3);
    expect(snap(7, EV)).toBe(5);
    expect(snap(-12.6, PCT)).toBe(-13);
  });
});

describe('formatValue', () => {
  it('signs values on a signed range', () => {
    expect(formatValue(0.3, EV)).toBe('+0.30');
    expect(formatValue(-12, PCT)).toBe('−12');
    expect(formatValue(0, PCT)).toBe('0');
    expect(formatValue(40, { min: 0, max: 100, step: 1 })).toBe('40');
  });

  it('does not show minus zero', () => {
    expect(formatValue(-0.001, EV)).toBe('0.00');
  });
});

describe('parseValue', () => {
  it('reads typed numbers', () => {
    expect(parseValue('+0.3', EV)).toBe(0.3);
    expect(parseValue('−1,5', EV)).toBe(-1.5);
    expect(parseValue('200', PCT)).toBe(100);
    expect(parseValue('abc', PCT)).toBeNull();
    expect(parseValue('', PCT)).toBeNull();
  });
});
