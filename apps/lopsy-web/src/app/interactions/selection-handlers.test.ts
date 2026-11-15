import { describe, it, expect } from 'vitest';
import { constrainMarqueeSize } from './selection-handlers';

describe('constrainMarqueeSize', () => {
  it('returns absolute raw size when no constraint applies', () => {
    const result = constrainMarqueeSize(120, -45, {
      metaPressed: false,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 120, h: 45 });
  });

  it('locks to 1:1 when meta is pressed regardless of persistent lock', () => {
    const result = constrainMarqueeSize(200, 50, {
      metaPressed: true,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result.w).toBe(result.h);
  });

  it('meta-pressed clamps to the smaller axis (w wider than h)', () => {
    const result = constrainMarqueeSize(200, 50, {
      metaPressed: true,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 50, h: 50 });
  });

  it('meta-pressed clamps to the smaller axis (h taller than w)', () => {
    const result = constrainMarqueeSize(40, 300, {
      metaPressed: true,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 40, h: 40 });
  });

  it('meta-pressed overrides a non-square persistent aspect ratio', () => {
    const result = constrainMarqueeSize(200, 60, {
      metaPressed: true,
      aspectRatioLocked: true,
      aspectRatioW: 16,
      aspectRatioH: 9,
    });
    expect(result.w).toBe(result.h);
    expect(result).toEqual({ w: 60, h: 60 });
  });

  it('uses persistent ratio when locked and meta is not pressed', () => {
    const result = constrainMarqueeSize(200, 60, {
      metaPressed: false,
      aspectRatioLocked: true,
      aspectRatioW: 2,
      aspectRatioH: 1,
    });
    expect(result.w / result.h).toBeCloseTo(2);
  });

  it('handles negative deltas (drag up-left from start)', () => {
    const result = constrainMarqueeSize(-150, -150, {
      metaPressed: true,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 150, h: 150 });
  });

  it('returns zero size when both deltas are zero', () => {
    const result = constrainMarqueeSize(0, 0, {
      metaPressed: true,
      aspectRatioLocked: false,
      aspectRatioW: 1,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 0, h: 0 });
  });

  it('does nothing when persistent lock has invalid (zero) ratio dims and meta is not pressed', () => {
    const result = constrainMarqueeSize(120, 80, {
      metaPressed: false,
      aspectRatioLocked: true,
      aspectRatioW: 0,
      aspectRatioH: 1,
    });
    expect(result).toEqual({ w: 120, h: 80 });
  });
});
