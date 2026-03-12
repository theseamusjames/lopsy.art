import { describe, it, expect } from 'vitest';
import { computeLayerMove, computeNudge, snapToGuide } from './move';

describe('computeLayerMove', () => {
  it('calculates correct delta', () => {
    const result = computeLayerMove({ x: 10, y: 20 }, { x: 15, y: 25 }, 100, 200);
    expect(result).toEqual({ x: 105, y: 205 });
  });

  it('handles negative movement', () => {
    const result = computeLayerMove({ x: 10, y: 10 }, { x: 5, y: 3 }, 50, 50);
    expect(result).toEqual({ x: 45, y: 43 });
  });
});

describe('computeNudge', () => {
  it('nudges up', () => {
    expect(computeNudge('up', 1, 50, 50)).toEqual({ x: 50, y: 49 });
  });

  it('nudges down', () => {
    expect(computeNudge('down', 10, 50, 50)).toEqual({ x: 50, y: 60 });
  });

  it('nudges left', () => {
    expect(computeNudge('left', 1, 50, 50)).toEqual({ x: 49, y: 50 });
  });

  it('nudges right', () => {
    expect(computeNudge('right', 5, 50, 50)).toEqual({ x: 55, y: 50 });
  });
});

describe('snapToGuide', () => {
  it('snaps when within threshold', () => {
    const result = snapToGuide(102, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: true, value: 100 });
  });

  it('does not snap when outside threshold', () => {
    const result = snapToGuide(110, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: false, value: 110 });
  });

  it('snaps to nearest guide within threshold', () => {
    const result = snapToGuide(199, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: true, value: 200 });
  });
});
