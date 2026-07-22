import { describe, it, expect } from 'vitest';
import {
  gestureUsedGpuStroke,
  withPaintGesture,
  withToolGesture,
  withMoveGesture,
  resolveDownGesture,
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

  it('returns true for paint gesture with usedGpuStroke=true', () => {
    const g: CanvasGesture = { kind: 'paint', usedGpuStroke: true };
    expect(gestureUsedGpuStroke(g)).toBe(true);
  });

  it('returns false for paint gesture with usedGpuStroke=false', () => {
    const g: CanvasGesture = { kind: 'paint', usedGpuStroke: false };
    expect(gestureUsedGpuStroke(g)).toBe(false);
  });

  it('returns false for tool gesture (non-paint tools cannot claim a GPU stroke)', () => {
    const g: CanvasGesture = { kind: 'tool' };
    expect(gestureUsedGpuStroke(g)).toBe(false);
  });

  it('returns false for non-paint gestures regardless of context', () => {
    const gestures: CanvasGesture[] = [
      { kind: 'idle' },
      { kind: 'tool' },
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
  ...overrides,
});

describe('withPaintGesture', () => {
  it('returns a paint gesture with the given usedGpuStroke flag', () => {
    const input = makeBaseState();
    const output = withPaintGesture(input, true);
    expect(output.gesture).toEqual({ kind: 'paint', usedGpuStroke: true });
  });

  it('preserves non-gesture fields from the input', () => {
    const input = makeBaseState({ layerId: 'abc', tool: 'pencil', drawing: true });
    const output = withPaintGesture(input, false);
    expect(output.layerId).toBe('abc');
    expect(output.tool).toBe('pencil');
    expect(output.drawing).toBe(true);
    expect(output.gesture).toEqual({ kind: 'paint', usedGpuStroke: false });
  });

  it('does not mutate the input state (no-mutation invariant from #444)', () => {
    const input = Object.freeze(makeBaseState({ gesture: GESTURE_IDLE }));
    const output = withPaintGesture(input, true);
    expect(input.gesture).toBe(GESTURE_IDLE);
    expect(output).not.toBe(input);
    expect(output.gesture).not.toBe(input.gesture);
  });

  it('does not mutate a previously-set paint gesture object', () => {
    const priorGesture: CanvasGesture = { kind: 'paint', usedGpuStroke: false };
    const input = makeBaseState({ gesture: priorGesture });
    const output = withPaintGesture(input, true);
    expect(priorGesture).toEqual({ kind: 'paint', usedGpuStroke: false });
    expect(output.gesture).not.toBe(priorGesture);
    expect(output.gesture).toEqual({ kind: 'paint', usedGpuStroke: true });
  });
});

describe('withToolGesture', () => {
  it('returns a data-less tool gesture', () => {
    const input = makeBaseState();
    const output = withToolGesture(input);
    expect(output.gesture).toEqual({ kind: 'tool' });
  });

  it('preserves non-gesture fields from the input', () => {
    const input = makeBaseState({ layerId: 'abc', tool: 'fill', drawing: true });
    const output = withToolGesture(input);
    expect(output.layerId).toBe('abc');
    expect(output.tool).toBe('fill');
    expect(output.drawing).toBe(true);
    expect(output.gesture).toEqual({ kind: 'tool' });
  });

  it('does not mutate the input state (no-mutation invariant from #444)', () => {
    const input = Object.freeze(makeBaseState({ gesture: GESTURE_IDLE }));
    const output = withToolGesture(input);
    expect(input.gesture).toBe(GESTURE_IDLE);
    expect(output).not.toBe(input);
    expect(output.gesture).not.toBe(input.gesture);
  });
});

describe('resolveDownGesture', () => {
  const marqueeMask = new Uint8ClampedArray([1, 2, 3, 4]);
  const makeMoveState = () =>
    withMoveGesture(makeBaseState({ tool: 'move' }), {
      originalMask: marqueeMask,
      originalBounds: { x: 10, y: 20, width: 30, height: 40 },
    });

  it('wraps paint-tool state in the paint variant', () => {
    const output = resolveDownGesture(makeBaseState(), { isPaintTool: true, usedGpuStroke: true });
    expect(output.gesture).toEqual({ kind: 'paint', usedGpuStroke: true });
  });

  it('wraps a gesture-less non-paint tool in the generic tool variant', () => {
    const output = resolveDownGesture(makeBaseState({ tool: 'fill' }), {
      isPaintTool: false,
      usedGpuStroke: false,
    });
    expect(output.gesture).toEqual({ kind: 'tool' });
  });

  it('keeps the move variant its handler already chose', () => {
    const input = makeMoveState();
    const output = resolveDownGesture(input, { isPaintTool: false, usedGpuStroke: false });
    expect(output.gesture.kind).toBe('move');
  });

  it('preserves the marquee snapshot the move handler packed inline', () => {
    const input = makeMoveState();
    const output = resolveDownGesture(input, { isPaintTool: false, usedGpuStroke: false });
    if (output.gesture.kind !== 'move') {
      throw new Error('expected the move gesture to survive dispatch');
    }
    // Dropping these left the marquee pinned in place while the floated
    // pixels moved under it — handleMoveMove needs originalBounds to
    // re-derive the selection rectangle on every pointer-move.
    expect(output.gesture.originalBounds).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(output.gesture.originalMask).toBe(marqueeMask);
  });

  it('keeps other handler-chosen variants intact', () => {
    const input = makeBaseState({ gesture: makeTransformGesture(), tool: 'move' });
    const output = resolveDownGesture(input, { isPaintTool: false, usedGpuStroke: false });
    expect(output.gesture.kind).toBe('transform');
  });

  it('does not mutate the input state', () => {
    const input = Object.freeze(makeBaseState());
    const output = resolveDownGesture(input, { isPaintTool: true, usedGpuStroke: false });
    expect(input.gesture).toBe(GESTURE_IDLE);
    expect(output).not.toBe(input);
  });
});

describe('CanvasGesture paint/tool split (#444)', () => {
  it('confines usedGpuStroke to the paint variant', () => {
    type PaintVariant = Extract<CanvasGesture, { kind: 'paint' }>;
    type ToolVariant = Extract<CanvasGesture, { kind: 'tool' }>;

    const _paintHasFlag: PaintVariant['usedGpuStroke'] = true;
    expect(_paintHasFlag).toBe(true);

    type ToolHasUsedGpuStroke = 'usedGpuStroke' extends keyof ToolVariant ? true : false;
    const _toolHasNoFlag: ToolHasUsedGpuStroke = false;
    expect(_toolHasNoFlag).toBe(false);
  });

  it('narrows to the paint variant via the discriminant', () => {
    const gesture: CanvasGesture = { kind: 'paint', usedGpuStroke: true };
    if (gesture.kind !== 'paint') {
      throw new Error('expected paint gesture');
    }
    const flag: boolean = gesture.usedGpuStroke;
    expect(flag).toBe(true);
  });
});
