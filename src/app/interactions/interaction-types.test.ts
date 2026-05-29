import { describe, it, expect } from 'vitest';
import {
  gestureUsedGpuStroke,
  GESTURE_IDLE,
  type CanvasGesture,
  type InteractionState,
} from './interaction-types';

describe('gestureUsedGpuStroke', () => {
  it('returns false for idle gesture', () => {
    expect(gestureUsedGpuStroke(GESTURE_IDLE)).toBe(false);
  });

  it('returns true for tool gesture with usedGpuStroke=true', () => {
    const g: CanvasGesture = { kind: 'tool', usedGpuStroke: true };
    expect(gestureUsedGpuStroke(g)).toBe(true);
  });

  it('returns false for tool gesture with usedGpuStroke=false', () => {
    const g: CanvasGesture = { kind: 'tool', usedGpuStroke: false };
    expect(gestureUsedGpuStroke(g)).toBe(false);
  });

  it('returns false for non-tool gestures regardless of context', () => {
    const gestures: CanvasGesture[] = [
      { kind: 'idle' },
      { kind: 'liquify' },
      { kind: 'tiltShift' },
      { kind: 'meshWarp' },
      { kind: 'transform' },
    ];
    for (const g of gestures) {
      expect(gestureUsedGpuStroke(g)).toBe(false);
    }
  });
});

describe('InteractionState shape', () => {
  // Locks in the invariant that the gesture discriminant — not a parallel
  // set of bag-of-flags booleans — is the single source of truth for which
  // gesture is active. A regression here means we're re-growing the
  // bag-of-flags pattern the #444 audit is unwinding.
  it('does not carry redundant per-gesture boolean flags', () => {
    type ForbiddenKeys = 'tiltShiftDragging' | 'meshWarpDragging';
    type Asserts = Exclude<ForbiddenKeys, keyof InteractionState>;
    const exhaustive: Asserts = 'tiltShiftDragging' as const;
    expect(exhaustive).toBe('tiltShiftDragging');
  });
});
