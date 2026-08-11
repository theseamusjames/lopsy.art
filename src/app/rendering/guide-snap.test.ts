import { describe, it, expect } from 'vitest';
import { snapGuideToFraction, _GUIDE_SNAP_FRACTIONS_FOR_TEST } from './guide-snap';

describe('snapGuideToFraction', () => {
  it('snaps to 1/2 near the midpoint', () => {
    expect(snapGuideToFraction(500, 1000)).toBe(500);
    expect(snapGuideToFraction(498, 1000)).toBe(500);
    expect(snapGuideToFraction(502, 1000)).toBe(500);
  });

  it('snaps to thirds', () => {
    expect(snapGuideToFraction(333, 1000)).toBe(333);
    expect(snapGuideToFraction(340, 1000)).toBe(333);
    expect(snapGuideToFraction(666, 1000)).toBe(667);
  });

  it('snaps to 1/16 for finer positions', () => {
    // 1/16 of 1600 = 100
    expect(snapGuideToFraction(105, 1600)).toBe(100);
    // 3/16 of 1600 = 300
    expect(snapGuideToFraction(298, 1600)).toBe(300);
    // 15/16 of 1600 = 1500
    expect(snapGuideToFraction(1495, 1600)).toBe(1500);
  });

  it('snaps to canvas edges (0 and docSize)', () => {
    expect(snapGuideToFraction(5, 1000)).toBe(0);
    expect(snapGuideToFraction(995, 1000)).toBe(1000);
    expect(snapGuideToFraction(-3, 1000)).toBe(0);
  });

  it('snaps to 1/4 and 3/4', () => {
    expect(snapGuideToFraction(255, 1000)).toBe(250);
    expect(snapGuideToFraction(748, 1000)).toBe(750);
  });

  it('returns rounded integer positions', () => {
    // 1/3 of 100 = 33.333...
    const result = snapGuideToFraction(33, 100);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('handles docSize of 0 by returning rounded position', () => {
    expect(snapGuideToFraction(42.7, 0)).toBe(43);
  });

  it('fraction table includes thirds', () => {
    expect(_GUIDE_SNAP_FRACTIONS_FOR_TEST).toContain(1 / 3);
    expect(_GUIDE_SNAP_FRACTIONS_FOR_TEST).toContain(2 / 3);
  });

  it('fraction table includes 1/16 steps', () => {
    for (let n = 1; n < 16; n += 2) {
      expect(_GUIDE_SNAP_FRACTIONS_FOR_TEST).toContain(n / 16);
    }
  });

  it('fraction table starts at 0 and ends at 1', () => {
    expect(_GUIDE_SNAP_FRACTIONS_FOR_TEST[0]).toBe(0);
    expect(_GUIDE_SNAP_FRACTIONS_FOR_TEST[_GUIDE_SNAP_FRACTIONS_FOR_TEST.length - 1]).toBe(1);
  });
});
