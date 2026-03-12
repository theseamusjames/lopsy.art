import { describe, it, expect } from 'vitest';
import { blendColors } from './blend';
import type { Color } from '../types/index';

const WHITE: Color = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
const RED: Color = { r: 255, g: 0, b: 0, a: 1 };
const MID_GRAY: Color = { r: 128, g: 128, b: 128, a: 1 };
const HALF_RED: Color = { r: 255, g: 0, b: 0, a: 0.5 };
const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };

describe('blendColors', () => {
  describe('normal', () => {
    it('fully opaque source replaces destination', () => {
      const result = blendColors(RED, WHITE, 'normal');
      expect(result.r).toBe(255);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
      expect(result.a).toBe(1);
    });

    it('transparent source returns destination', () => {
      const result = blendColors(TRANSPARENT, WHITE, 'normal');
      expect(result).toEqual(WHITE);
    });

    it('semi-transparent source blends with destination', () => {
      const result = blendColors(HALF_RED, WHITE, 'normal');
      expect(result.a).toBe(1);
      expect(result.r).toBe(255);
      // Green and blue should be mixed: 0*0.5 + 255*1*0.5 = 127.5
      expect(result.g).toBeCloseTo(128, 0);
      expect(result.b).toBeCloseTo(128, 0);
    });
  });

  describe('multiply', () => {
    it('white * color = color', () => {
      const result = blendColors(WHITE, RED, 'multiply');
      expect(result.r).toBe(255);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it('black * anything = black', () => {
      const result = blendColors(BLACK, WHITE, 'multiply');
      expect(result.r).toBe(0);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it('gray * gray produces darker gray', () => {
      const result = blendColors(MID_GRAY, MID_GRAY, 'multiply');
      // 128 * 128 / 255 ≈ 64
      expect(result.r).toBeCloseTo(64, 0);
    });
  });

  describe('screen', () => {
    it('black screened with color = color', () => {
      const result = blendColors(BLACK, RED, 'screen');
      expect(result.r).toBe(255);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it('white screened with anything = white', () => {
      const result = blendColors(WHITE, MID_GRAY, 'screen');
      expect(result.r).toBe(255);
      expect(result.g).toBe(255);
      expect(result.b).toBe(255);
    });

    it('gray screened with gray produces lighter gray', () => {
      const result = blendColors(MID_GRAY, MID_GRAY, 'screen');
      // 255 - (127 * 127) / 255 ≈ 192
      expect(result.r).toBeGreaterThan(128);
    });
  });

  describe('overlay', () => {
    it('preserves black on black', () => {
      const result = blendColors(BLACK, BLACK, 'overlay');
      expect(result.r).toBe(0);
    });

    it('preserves white on white', () => {
      const result = blendColors(WHITE, WHITE, 'overlay');
      expect(result.r).toBe(255);
    });

    it('mid gray on mid gray produces roughly mid gray', () => {
      const result = blendColors(MID_GRAY, MID_GRAY, 'overlay');
      // overlay(128, 128): dst < 128 is false so: 255 - 2*(127)*(127)/255 ≈ 128
      expect(result.r).toBeGreaterThan(100);
      expect(result.r).toBeLessThan(160);
    });
  });

  describe('darken', () => {
    it('keeps the darker channel', () => {
      const result = blendColors(MID_GRAY, WHITE, 'darken');
      expect(result.r).toBe(128);
      expect(result.g).toBe(128);
      expect(result.b).toBe(128);
    });

    it('black darkens everything to black', () => {
      const result = blendColors(BLACK, WHITE, 'darken');
      expect(result.r).toBe(0);
    });
  });

  describe('lighten', () => {
    it('keeps the lighter channel', () => {
      const result = blendColors(MID_GRAY, BLACK, 'lighten');
      expect(result.r).toBe(128);
      expect(result.g).toBe(128);
      expect(result.b).toBe(128);
    });

    it('white lightens everything to white', () => {
      const result = blendColors(WHITE, BLACK, 'lighten');
      expect(result.r).toBe(255);
    });
  });

  describe('difference', () => {
    it('same color produces black', () => {
      const result = blendColors(RED, RED, 'difference');
      expect(result.r).toBe(0);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it('black difference with color = color', () => {
      const result = blendColors(BLACK, MID_GRAY, 'difference');
      expect(result.r).toBe(128);
    });

    it('white difference with color = inverse', () => {
      const result = blendColors(WHITE, MID_GRAY, 'difference');
      expect(result.r).toBe(127);
    });
  });

  describe('unsupported blend modes fall back to normal', () => {
    it('color-dodge falls back to normal', () => {
      const result = blendColors(RED, WHITE, 'color-dodge');
      expect(result.r).toBe(255);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });
  });
});
