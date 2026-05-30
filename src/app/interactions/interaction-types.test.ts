import { describe, it, expect } from 'vitest';
import {
  gestureUsedGpuStroke,
  GESTURE_IDLE,
  type CanvasGesture,
  type InteractionState,
} from './interaction-types';
import { createTransformState } from '../../tools/transform/transform';

const makeTransformGesture = (): Extract<CanvasGesture, { kind: 'transform' }> => ({
  kind: 'transform',
  handle: 'top-left',
  startState: createTransformState({ x: 0, y: 0, width: 100, height: 100 }),
  startAngle: 0,
  selectionOnly: false,
});

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
      makeTransformGesture(),
    ];
    for (const g of gestures) {
      expect(gestureUsedGpuStroke(g)).toBe(false);
    }
  });
});

describe('InteractionState shape', () => {
  it('does not carry redundant per-gesture boolean flags', () => {
    type ForbiddenKeys = 'tiltShiftDragging' | 'meshWarpDragging';
    type Asserts = Exclude<ForbiddenKeys, keyof InteractionState>;
    const exhaustive: Asserts = 'tiltShiftDragging' as const;
    expect(exhaustive).toBe('tiltShiftDragging');
  });
});

describe('CanvasGesture transform variant ownership', () => {
  type ForbiddenKeys =
    | 'transformHandle'
    | 'transformStartState'
    | 'transformStartAngle'
    | 'selectionOnlyTransform';

  type Leaked = Extract<keyof InteractionState, ForbiddenKeys>;

  const _check: Leaked extends never ? true : false = true;

  it('keeps transform metadata off the shared InteractionState', () => {
    expect(_check).toBe(true);
  });

  it('carries handle/startState/startAngle/selectionOnly on the variant', () => {
    const gesture = makeTransformGesture();
    expect(gesture.handle).toBe('top-left');
    expect(gesture.startState.scaleX).toBe(1);
    expect(gesture.startAngle).toBe(0);
    expect(gesture.selectionOnly).toBe(false);
  });

  it('narrows variant data via the discriminant without non-null assertions', () => {
    const gesture: CanvasGesture = makeTransformGesture();
    if (gesture.kind !== 'transform') {
      throw new Error('expected transform gesture');
    }
    const handle: string = gesture.handle;
    const startAngle: number = gesture.startAngle;
    expect(handle).toBe('top-left');
    expect(startAngle).toBe(0);
  });
});
