import { describe, it, expect } from 'vitest';
import {
  gestureUsedGpuStroke,
  withToolGesture,
  GESTURE_IDLE,
  INITIAL_INTERACTION_STATE,
  type CanvasGesture,
  type InteractionState,
  type PreToolDownGuard,
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
      { kind: 'liquify', lastPoint: { x: 0, y: 0 } },
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

describe('INITIAL_INTERACTION_STATE', () => {
  it('starts idle with no drawing', () => {
    expect(INITIAL_INTERACTION_STATE.drawing).toBe(false);
    expect(INITIAL_INTERACTION_STATE.gesture.kind).toBe('idle');
    expect(INITIAL_INTERACTION_STATE.layerId).toBeNull();
    expect(INITIAL_INTERACTION_STATE.tool).toBeNull();
  });
});

describe('PreToolDownGuard signature', () => {
  it('accepts (canvasPos, activeLayerId) and returns InteractionState | null', () => {
    const guard: PreToolDownGuard = (canvasPos, activeLayerId) => {
      if (!activeLayerId) return null;
      return {
        ...INITIAL_INTERACTION_STATE,
        drawing: true,
        gesture: { kind: 'liquify', lastPoint: { x: 0, y: 0 } },
        layerId: activeLayerId,
        startPoint: canvasPos,
      };
    };

    expect(guard({ x: 0, y: 0 }, '')).toBeNull();

    const claimed = guard({ x: 5, y: 5 }, 'layer-1');
    expect(claimed).not.toBeNull();
    expect(claimed?.layerId).toBe('layer-1');
    expect(claimed?.gesture.kind).toBe('liquify');
  });
});

const makeBaseState = (overrides: Partial<InteractionState> = {}): InteractionState => ({
  drawing: true,
  gesture: GESTURE_IDLE,
  lastPoint: null,
  layerId: 'layer-1',
  tool: 'brush',
  startPoint: null,
  layerStartX: 0,
  layerStartY: 0,
  maskMode: false,
  originalSelectionMask: null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  moveOriginalMask: null,
  moveOriginalBounds: null,
  ...overrides,
});

describe('withToolGesture', () => {
  it('returns a tool gesture with the given usedGpuStroke flag', () => {
    const input = makeBaseState();
    const output = withToolGesture(input, true);
    expect(output.gesture).toEqual({ kind: 'tool', usedGpuStroke: true });
  });

  it('preserves non-gesture fields from the input', () => {
    const input = makeBaseState({ layerId: 'abc', tool: 'pencil', drawing: true });
    const output = withToolGesture(input, false);
    expect(output.layerId).toBe('abc');
    expect(output.tool).toBe('pencil');
    expect(output.drawing).toBe(true);
    expect(output.gesture).toEqual({ kind: 'tool', usedGpuStroke: false });
  });

  it('does not mutate the input state (no-mutation invariant from #444)', () => {
    const input = Object.freeze(makeBaseState({ gesture: GESTURE_IDLE }));
    const output = withToolGesture(input, true);
    expect(input.gesture).toBe(GESTURE_IDLE);
    expect(output).not.toBe(input);
    expect(output.gesture).not.toBe(input.gesture);
  });

  it('does not mutate a previously-set tool gesture object', () => {
    const priorGesture: CanvasGesture = { kind: 'tool', usedGpuStroke: false };
    const input = makeBaseState({ gesture: priorGesture });
    const output = withToolGesture(input, true);
    expect(priorGesture).toEqual({ kind: 'tool', usedGpuStroke: false });
    expect(output.gesture).not.toBe(priorGesture);
    expect(output.gesture).toEqual({ kind: 'tool', usedGpuStroke: true });
  });
});
