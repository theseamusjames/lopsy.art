import { describe, it, expect } from 'vitest';
import { formatFractionLabel, snapGuideToFraction, _GUIDE_SNAP_FRACTIONS_FOR_TEST } from './guide-snap';

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

describe('formatFractionLabel', () => {
  it('labels the midpoint as 1/2', () => {
    expect(formatFractionLabel(500, 1000)).toBe('1/2');
  });

  it('labels 1/3 and 2/3 with integer rounding', () => {
    // 1/3 * 1000 rounds to 333, 2/3 * 1000 rounds to 667
    expect(formatFractionLabel(333, 1000)).toBe('1/3');
    expect(formatFractionLabel(667, 1000)).toBe('2/3');
  });

  it('labels 1/4 and 3/4', () => {
    expect(formatFractionLabel(250, 1000)).toBe('1/4');
    expect(formatFractionLabel(750, 1000)).toBe('3/4');
  });

  it('labels 1/16 through 15/16 (odd numerators only, since evens reduce)', () => {
    // docSize = 1600 gives integer positions at every 100
    expect(formatFractionLabel(100, 1600)).toBe('1/16');
    expect(formatFractionLabel(300, 1600)).toBe('3/16');
    expect(formatFractionLabel(500, 1600)).toBe('5/16');
    expect(formatFractionLabel(1500, 1600)).toBe('15/16');
  });

  it('labels the edges as 0/1 and 1/1', () => {
    expect(formatFractionLabel(0, 1000)).toBe('0/1');
    expect(formatFractionLabel(1000, 1000)).toBe('1/1');
  });

  it('returns null for positions that do not match a snap fraction', () => {
    // 100 / 1000 = 1/10, which is not in the snap table
    expect(formatFractionLabel(100, 1000)).toBeNull();
    // arbitrary non-fraction
    expect(formatFractionLabel(217, 1000)).toBeNull();
  });

  it('returns null when docSize is 0', () => {
    expect(formatFractionLabel(500, 0)).toBeNull();
  });

  it('round-trips with snapGuideToFraction for every fraction in the table', () => {
    const docSize = 960;
    for (const t of _GUIDE_SNAP_FRACTIONS_FOR_TEST) {
      const pos = snapGuideToFraction(t * docSize, docSize);
      expect(formatFractionLabel(pos, docSize)).not.toBeNull();
    }
  });
});
