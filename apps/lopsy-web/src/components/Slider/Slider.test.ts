import { describe, it, expect } from 'vitest';
import { commitSliderValue, sliderKnobPosition } from './Slider';

describe('commitSliderValue', () => {
  it('clamps a typed value above max down to max', () => {
    expect(commitSliderValue('15', 0, -5, 5)).toBe(5);
  });

  it('clamps a typed value below min up to min', () => {
    expect(commitSliderValue('-100', 0, -5, 5)).toBe(-5);
  });

  it('returns an in-range value unchanged', () => {
    expect(commitSliderValue('2.5', 0, -5, 5)).toBe(2.5);
  });

  it('returns the current value when the input cannot be parsed', () => {
    expect(commitSliderValue('abc', 1.25, 0, 10)).toBe(1.25);
    expect(commitSliderValue('', 1.25, 0, 10)).toBe(1.25);
  });

  it('clamps a value at the exact max boundary', () => {
    expect(commitSliderValue('5', 0, -5, 5)).toBe(5);
  });

  it('clamps a value at the exact min boundary', () => {
    expect(commitSliderValue('-5', 0, -5, 5)).toBe(-5);
  });

  it('handles fractional ranges (e.g. opacity 0..1)', () => {
    expect(commitSliderValue('1.7', 0.5, 0, 1)).toBe(1);
    expect(commitSliderValue('-0.2', 0.5, 0, 1)).toBe(0);
    expect(commitSliderValue('0.3', 0.5, 0, 1)).toBe(0.3);
  });

  it('regression: Exposure typing 15 with max=5 must not commit 15', () => {
    // Issue #261: typing 15 into Exposure (max=5) was producing 2^15 multiplier
    // and blowing every pixel to white. After the fix, the commit should clamp
    // to the declared max so the on-canvas effect stays bounded.
    const result = commitSliderValue('15', 0, -5, 5);
    expect(result).toBe(5);
    expect(result).toBeLessThanOrEqual(5);
  });
});

describe('sliderKnobPosition', () => {
  it('returns the value unchanged when within slider range (linear)', () => {
    expect(sliderKnobPosition(150, 1, 300)).toBe(150);
  });

  it('clamps a value above sliderMax to sliderMax (linear)', () => {
    // Issue #364: brush size can be typed up to e.g. 2880 but the slider
    // visual range is 1..300. The knob must pin at sliderMax so it stays
    // visible at the right edge instead of overflowing.
    expect(sliderKnobPosition(2880, 1, 300)).toBe(300);
  });

  it('clamps a value below sliderMin to sliderMin (linear)', () => {
    expect(sliderKnobPosition(-10, 1, 300)).toBe(1);
  });

  it('maps log scale within bounds and clamps outside the range', () => {
    // At sliderMin and sliderMax the log mapping is identity (norm 0 and 1).
    expect(sliderKnobPosition(1, 1, 1000, 'log')).toBe(1);
    expect(sliderKnobPosition(1000, 1, 1000, 'log')).toBe(1000);
    // A value beyond sliderMax must clamp before the log mapping so the knob
    // doesn't slide off the right end of the track.
    expect(sliderKnobPosition(5000, 1, 1000, 'log')).toBe(1000);
  });
});
