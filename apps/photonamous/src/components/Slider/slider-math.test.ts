import { describe, expect, it } from 'vitest';
import { decimalsOf, dragValue, formatValue, fraction, keyValue, parseValue, snap, valueText } from './slider-math';

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

describe('dragValue', () => {
  it('maps the track width to the whole range', () => {
    expect(dragValue(0, 100, 200, PCT, false)).toBe(100);
    expect(dragValue(0, -50, 200, PCT, false)).toBe(-50);
  });

  it('moves ten times slower when fine', () => {
    expect(dragValue(0, 100, 200, PCT, true)).toBe(10);
  });
});

describe('keyValue', () => {
  it('steps, with ten steps for large moves', () => {
    expect(keyValue(0, 'ArrowRight', false, EV)).toBe(0.01);
    expect(keyValue(0, 'ArrowLeft', true, EV)).toBe(-0.1);
    expect(keyValue(99, 'ArrowUp', false, PCT)).toBe(100);
    expect(keyValue(100, 'ArrowUp', false, PCT)).toBe(100);
    expect(keyValue(3, 'Home', false, PCT)).toBe(-100);
    expect(keyValue(3, 'x', false, PCT)).toBeNull();
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

describe('fraction', () => {
  it('places the value on the track', () => {
    expect(fraction(0, PCT)).toBe(0.5);
    expect(fraction(-100, PCT)).toBe(0);
    expect(fraction(500, PCT)).toBe(1);
  });
});

describe('valueText', () => {
  it('says the readout with its unit, or the readout alone', () => {
    expect(valueText(formatValue(0.5, EV), 'EV')).toBe('+0.50 EV');
    expect(valueText('−12')).toBe('−12');
  });
});
