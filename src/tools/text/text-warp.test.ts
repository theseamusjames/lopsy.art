import { describe, it, expect } from 'vitest';
import { applyWarp } from './text-warp';

const W = 200;
const H = 60;

describe('applyWarp', () => {
  describe('identity cases', () => {
    it('returns the input point unchanged when style is none', () => {
      const pt = applyWarp(100, 30, W, H, 'none', 50);
      expect(pt.x).toBe(100);
      expect(pt.y).toBe(30);
    });

    it('returns the input point unchanged when bend is 0', () => {
      for (const style of ['arc', 'bulge', 'flag', 'wave', 'fish', 'rise', 'squeeze'] as const) {
        const pt = applyWarp(100, 30, W, H, style, 0);
        expect(pt.x).toBe(100);
        expect(pt.y).toBe(30);
      }
    });
  });

  describe('arc', () => {
    it('displaces y at the horizontal centre with positive bend', () => {
      // At x = W/2 the sine is 1, so y should be reduced (moved upward)
      const pt = applyWarp(W / 2, H / 2, W, H, 'arc', 100);
      expect(pt.y).toBeLessThan(H / 2);
    });

    it('displaces y at the horizontal centre downward with negative bend', () => {
      const pt = applyWarp(W / 2, H / 2, W, H, 'arc', -100);
      expect(pt.y).toBeGreaterThan(H / 2);
    });

    it('does not displace y at the left edge (sine is 0)', () => {
      const pt = applyWarp(0, H / 2, W, H, 'arc', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });

    it('does not displace y at the right edge (sine is 0)', () => {
      const pt = applyWarp(W, H / 2, W, H, 'arc', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });

    it('never displaces x', () => {
      const pt = applyWarp(123, H / 2, W, H, 'arc', 75);
      expect(pt.x).toBe(123);
    });
  });

  describe('arc-lower', () => {
    it('is larger displacement at the bottom than at the top', () => {
      const top = applyWarp(W / 2, 0, W, H, 'arc-lower', 100);
      const bot = applyWarp(W / 2, H, W, H, 'arc-lower', 100);
      expect(Math.abs(H - bot.y)).toBeGreaterThan(Math.abs(0 - top.y));
    });

    it('does not displace y at x=0', () => {
      const pt = applyWarp(0, H / 2, W, H, 'arc-lower', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });
  });

  describe('arc-upper', () => {
    it('is larger displacement at the top than at the bottom', () => {
      const top = applyWarp(W / 2, 0, W, H, 'arc-upper', 100);
      const bot = applyWarp(W / 2, H, W, H, 'arc-upper', 100);
      expect(Math.abs(0 - top.y)).toBeGreaterThan(Math.abs(H - bot.y));
    });
  });

  describe('bulge', () => {
    it('does not displace x at the horizontal centre', () => {
      const pt = applyWarp(W / 2, H / 2, W, H, 'bulge', 100);
      expect(pt.x).toBeCloseTo(W / 2, 5);
    });

    it('displaces x outward to the right of centre with positive bend', () => {
      const pt = applyWarp(W * 0.75, H / 2, W, H, 'bulge', 100);
      expect(pt.x).toBeGreaterThan(W * 0.75);
    });

    it('displaces x outward to the left of centre with positive bend', () => {
      const pt = applyWarp(W * 0.25, H / 2, W, H, 'bulge', 100);
      expect(pt.x).toBeLessThan(W * 0.25);
    });

    it('never displaces y', () => {
      const pt = applyWarp(W / 2, H / 2, W, H, 'bulge', 100);
      expect(pt.y).toBe(H / 2);
    });
  });

  describe('flag', () => {
    it('produces non-zero y displacement in the middle of the text', () => {
      const pt = applyWarp(W / 4, H / 2, W, H, 'flag', 100);
      expect(pt.y).not.toBe(H / 2);
    });

    it('is zero at x=0 (sin(0) = 0)', () => {
      const pt = applyWarp(0, H / 2, W, H, 'flag', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });

    it('never displaces x', () => {
      const pt = applyWarp(50, H / 2, W, H, 'flag', 100);
      expect(pt.x).toBe(50);
    });
  });

  describe('wave', () => {
    it('produces displacement at x = W/8', () => {
      const pt = applyWarp(W / 8, H / 2, W, H, 'wave', 100);
      expect(pt.y).not.toBeCloseTo(H / 2, 2);
    });

    it('has zero displacement at x=0', () => {
      const pt = applyWarp(0, H / 2, W, H, 'wave', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });
  });

  describe('fish', () => {
    it('does not displace x at the centre', () => {
      const pt = applyWarp(W / 2, H / 2, W, H, 'fish', 100);
      expect(pt.x).toBeCloseTo(W / 2, 3);
    });

    it('never displaces y', () => {
      const pt = applyWarp(50, H / 2, W, H, 'fish', 100);
      expect(pt.y).toBe(H / 2);
    });
  });

  describe('rise', () => {
    it('has no y displacement at x=0', () => {
      const pt = applyWarp(0, H / 2, W, H, 'rise', 100);
      expect(pt.y).toBeCloseTo(H / 2, 5);
    });

    it('displaces y upward at x=W with positive bend', () => {
      const pt = applyWarp(W, H / 2, W, H, 'rise', 100);
      expect(pt.y).toBeLessThan(H / 2);
    });

    it('displaces y downward at x=W with negative bend', () => {
      const pt = applyWarp(W, H / 2, W, H, 'rise', -100);
      expect(pt.y).toBeGreaterThan(H / 2);
    });

    it('never displaces x', () => {
      const pt = applyWarp(100, H / 2, W, H, 'rise', 100);
      expect(pt.x).toBe(100);
    });
  });

  describe('squeeze', () => {
    it('does not displace x at the top edge (t = -1, sin^2 = 0)', () => {
      // At y=0, t=(0-H/2)/(H/2) = -1, so (1 - t^2) = 0 → no deformation
      const pt = applyWarp(W * 0.25, 0, W, H, 'squeeze', 100);
      expect(pt.x).toBeCloseTo(W * 0.25, 3);
    });

    it('does not displace x at the bottom edge', () => {
      const pt = applyWarp(W * 0.25, H, W, H, 'squeeze', 100);
      expect(pt.x).toBeCloseTo(W * 0.25, 3);
    });

    it('squeezes x toward centre at mid-height with positive bend', () => {
      // At y=H/2, t=0, (1 - t^2) = 1 → maximum deformation
      const pt = applyWarp(W * 0.75, H / 2, W, H, 'squeeze', 100);
      expect(pt.x).toBeLessThan(W * 0.75);
    });
  });
});
