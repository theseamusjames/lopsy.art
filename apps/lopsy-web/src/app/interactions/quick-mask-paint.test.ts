import { describe, it, expect } from 'vitest';
import { getQuickMaskPaintMode } from './quick-mask-paint';
import type { Color } from '../../types';

const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Color = { r: 255, g: 255, b: 255, a: 1 };
const MID_GRAY: Color = { r: 128, g: 128, b: 128, a: 1 };
const NEAR_BLACK: Color = { r: 30, g: 30, b: 30, a: 1 };
const NEAR_WHITE: Color = { r: 230, g: 230, b: 230, a: 1 };
const SATURATED_RED: Color = { r: 255, g: 0, b: 0, a: 1 };
const SATURATED_GREEN: Color = { r: 0, g: 255, b: 0, a: 1 };
const SATURATED_BLUE: Color = { r: 0, g: 0, b: 255, a: 1 };

describe('getQuickMaskPaintMode', () => {
  it('returns 1 (add overlay / shrink selection) when brush is black', () => {
    expect(getQuickMaskPaintMode('brush', BLACK)).toBe(1);
  });

  it('returns 0 (remove overlay / grow selection) when brush is white', () => {
    expect(getQuickMaskPaintMode('brush', WHITE)).toBe(0);
  });

  it('treats pencil the same as brush', () => {
    expect(getQuickMaskPaintMode('pencil', BLACK)).toBe(1);
    expect(getQuickMaskPaintMode('pencil', WHITE)).toBe(0);
  });

  it('returns 1 for eraser regardless of color', () => {
    expect(getQuickMaskPaintMode('eraser', BLACK)).toBe(1);
    expect(getQuickMaskPaintMode('eraser', WHITE)).toBe(1);
    expect(getQuickMaskPaintMode('eraser', MID_GRAY)).toBe(1);
  });

  it('treats near-black brush as dark (mode 1)', () => {
    expect(getQuickMaskPaintMode('brush', NEAR_BLACK)).toBe(1);
  });

  it('treats near-white brush as light (mode 0)', () => {
    expect(getQuickMaskPaintMode('brush', NEAR_WHITE)).toBe(0);
  });

  it('treats mid-gray brush as light (>= mid threshold)', () => {
    expect(getQuickMaskPaintMode('brush', MID_GRAY)).toBe(0);
  });

  it('uses perceptual luminance so saturated red is dark', () => {
    expect(getQuickMaskPaintMode('brush', SATURATED_RED)).toBe(1);
  });

  it('uses perceptual luminance so saturated green is light', () => {
    expect(getQuickMaskPaintMode('brush', SATURATED_GREEN)).toBe(0);
  });

  it('uses perceptual luminance so saturated blue is dark', () => {
    expect(getQuickMaskPaintMode('brush', SATURATED_BLUE)).toBe(1);
  });
});
