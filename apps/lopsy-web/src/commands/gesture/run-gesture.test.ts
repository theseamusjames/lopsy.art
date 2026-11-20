// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GestureEnvironment, ToolEvent } from '../../app/interactions/gesture-session';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const engine = { current: {} as unknown };
vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => engine.current };
});

const calls: string[] = [];
const gesture = vi.hoisted(() => ({
  down: vi.fn<(e: ToolEvent, env: GestureEnvironment) => void>(),
  move: vi.fn<(e: ToolEvent, env: GestureEnvironment) => void>(),
  up: vi.fn<(e: ToolEvent, env: GestureEnvironment) => void>(),
}));
vi.mock('../../app/interactions/gesture-session', () => ({
  gestureDown: gesture.down,
  gestureMove: gesture.move,
  gestureUp: gesture.up,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { docPointSpec, documentEnvironment, pointsSpec, runGesture } = await import('./run-gesture');
const { validateParams } = await import('../params');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function store() {
  return useEditorStore.getState();
}

function activeId(): string {
  const id = store().document.activeLayerId;
  if (!id) throw new Error('no active layer');
  return id;
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = store().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
}

function failure(fn: () => unknown): InstanceType<typeof CommandError> {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a throw');
}

function event(x: number, y: number, over: Partial<ToolEvent> = {}): ToolEvent {
  return { clientX: x, clientY: y, button: 0, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, detail: undefined, ...over };
}

beforeEach(() => {
  calls.length = 0;
  engine.current = null;
  store().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  useUIStore.getState().setIsInteracting(false);
  gesture.down.mockReset().mockImplementation(() => { calls.push(`down interacting=${useUIStore.getState().isInteracting}`); });
  gesture.move.mockReset().mockImplementation(() => { calls.push('move'); });
  gesture.up.mockReset().mockImplementation(() => { calls.push(`up interacting=${useUIStore.getState().isInteracting}`); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('documentEnvironment', () => {
  it('rounds for the canvas position and floors for the pixel, as App.tsx does after its viewport transform', () => {
    expect(documentEnvironment.toCanvas(10.5, 3.49)).toEqual({ x: 11, y: 3 });
    expect(documentEnvironment.toPixel(10.5, 3.49)).toEqual({ x: 10, y: 3 });
    expect(documentEnvironment.toCanvas(-0.6, 2.5)).toEqual({ x: -1, y: 3 });
    expect(documentEnvironment.toPixel(-0.6, 2.5)).toEqual({ x: -1, y: 2 });
  });
});

describe('runGesture', () => {
  it('presses at the first point, moves through the rest and releases at the last, synchronously', () => {
    const result = runGesture({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5.5, y: 6 }] });

    expect(result).toEqual({ tool: 'brush', layer: activeId() });
    expect(gesture.down).toHaveBeenCalledWith(event(1, 2), documentEnvironment);
    expect(gesture.move.mock.calls).toEqual([[event(3, 4), documentEnvironment], [event(5.5, 6), documentEnvironment]]);
    expect(gesture.up).toHaveBeenCalledWith(event(5.5, 6), documentEnvironment);
    expect(calls).toEqual(['down interacting=false', 'move', 'move', 'up interacting=true']);
    expect(useUIStore.getState().isInteracting).toBe(false);
    expect(useUIStore.getState().cursorPosition).toEqual({ x: 6, y: 6 });
  });

  it('makes one point a click: a press and a release with no move, with the modifiers and click count', () => {
    runGesture({ points: [{ x: 7, y: 8 }], shift: true, alt: true, meta: true, clicks: 2 });

    expect(gesture.down).toHaveBeenCalledWith(event(7, 8, { shiftKey: true, altKey: true, metaKey: true, detail: 2 }), documentEnvironment);
    expect(gesture.move).not.toHaveBeenCalled();
    expect(gesture.up).toHaveBeenCalledWith(event(7, 8, { shiftKey: true, altKey: true, metaKey: true }), documentEnvironment);
  });

  it('switches to the tool first when it is not active', () => {
    let toolAtPress: string | null = null;
    gesture.down.mockImplementation(() => { toolAtPress = useUIStore.getState().activeTool; });
    expect(runGesture({ tool: 'eraser', points: [{ x: 1, y: 1 }] }).tool).toBe('eraser');
    expect(toolAtPress).toBe('eraser');
  });

  it('refuses a locked layer for a tool the lock applies to, and lets a selection tool through', () => {
    patchActive({ locked: true });
    expect(failure(() => runGesture({ points: [{ x: 1, y: 1 }] }))).toMatchObject({
      code: 'refused',
      message: '"Layer 1" is locked: unlock it to use the Brush tool on it.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
    runGesture({ tool: 'marquee-rect', points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] });
    expect(gesture.down).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['text', 'Text layers must be rasterized before they can be painted on.'],
    ['group', "Groups can't be painted on. Select a layer inside the group."],
  ])('refuses a pixel-writing tool on a %s layer with the toast\'s text and notice', (type, message) => {
    patchActive({ type });
    const error = failure(() => runGesture({ tool: 'gradient', points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }));
    expect(error).toMatchObject({ code: 'refused', message, notice: 'info' });
    expect(gesture.down).not.toHaveBeenCalled();
  });

  it('lets the Shape tool with path output through on a group, as the dispatcher does', () => {
    patchActive({ type: 'group' });
    useToolSettingsStore.getState().setShapeSetting('output', 'path');
    runGesture({ tool: 'shape', points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] });
    expect(gesture.down).toHaveBeenCalledTimes(1);
    useToolSettingsStore.getState().setShapeSetting('output', 'pixels');
  });

  it('refuses with no active layer, no points, no document and no engine', () => {
    expect(failure(() => runGesture({ points: [] }))).toMatchObject({ code: 'invalid' });
    useEditorStore.setState({ document: { ...store().document, activeLayerId: null } });
    expect(failure(() => runGesture({ points: [{ x: 1, y: 1 }] }))).toMatchObject({ code: 'refused', message: 'There is no active layer.' });
    engine.current = null;
    expect(failure(() => runGesture({ points: [{ x: 1, y: 1 }] }))).toMatchObject({ code: 'unavailable' });
    useEditorStore.setState({ documentReady: false });
    expect(failure(() => runGesture({ points: [{ x: 1, y: 1 }] }))).toMatchObject({ code: 'unavailable' });
    expect(gesture.down).not.toHaveBeenCalled();
  });

  it('releases at the last point delivered and clears the interacting flag when a move throws, then rethrows', () => {
    const bug = new Error('move failed');
    gesture.move.mockImplementation((e) => {
      calls.push(`move ${e.clientX}`);
      if (e.clientX === 5) throw bug;
    });
    expect(() => runGesture({ points: [{ x: 1, y: 1 }, { x: 3, y: 3 }, { x: 5, y: 5 }, { x: 7, y: 7 }] })).toThrow(bug);
    expect(calls).toEqual(['down interacting=false', 'move 3', 'move 5', 'up interacting=true']);
    expect(gesture.up).toHaveBeenCalledWith(event(3, 3), documentEnvironment);
    expect(useUIStore.getState().isInteracting).toBe(false);
  });

  it('clears the interacting flag when the release throws, then rethrows', () => {
    const bug = new Error('up failed');
    gesture.up.mockImplementation(() => {
      throw bug;
    });
    expect(() => runGesture({ points: [{ x: 1, y: 1 }, { x: 3, y: 3 }] })).toThrow(bug);
    expect(useUIStore.getState().isInteracting).toBe(false);
  });

  it.each([
    ['liquify', 'Liquify'],
    ['tiltShift', 'Tilt-Shift'],
    ['meshWarp', 'Mesh Warp'],
  ])('refuses while a %s session is open, naming it, before any press', (field, name) => {
    useUIStore.setState({ [field]: {} } as unknown as Partial<ReturnType<typeof useUIStore.getState>>);
    try {
      expect(failure(() => runGesture({ points: [{ x: 1, y: 1 }] }))).toMatchObject({
        code: 'refused',
        message: `A ${name} session is open, and it would take the press instead of the tool: apply or cancel it first.`,
      });
      expect(gesture.down).not.toHaveBeenCalled();
    } finally {
      useUIStore.setState({ [field]: null } as unknown as Partial<ReturnType<typeof useUIStore.getState>>);
    }
  });
});

describe('gesture point specs', () => {
  it('reject a coordinate beyond the document-side range, which would hang stroke interpolation', () => {
    const schema = { points: pointsSpec('Path.'), at: docPointSpec('Point.') };
    const far = { points: [{ x: 0, y: 0 }, { x: 1e17, y: 0 }], at: { x: 0, y: 0 } };
    expect(() => validateParams('paint.stroke', schema, far)).toThrow(/points\[1\]\.x must be a finite number from -16384 to 32768, got 100000000000000000/);
    expect(() => validateParams('paint.stroke', schema, { points: [{ x: 0, y: 0 }], at: { x: 0, y: -16385 } })).toThrow(/at\.y must be/);
    expect(validateParams('paint.stroke', schema, { points: [{ x: -16384, y: 32768 }], at: { x: -5, y: 300 } })).toBeTruthy();
  });
});
