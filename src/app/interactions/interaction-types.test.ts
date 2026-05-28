import { describe, it, expect } from 'vitest';
import {
  gestureUsedGpuStroke,
  GESTURE_IDLE,
  type CanvasGesture,
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
