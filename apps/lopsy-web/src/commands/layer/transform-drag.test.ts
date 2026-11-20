// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransformState } from '../../tools/transform/transform';
import type { GestureInput } from '../gesture/run-gesture';
import type { Layer } from '../../types';

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

const gesture = vi.hoisted(() => ({
  run: vi.fn(),
  held: vi.fn(),
  check: vi.fn(),
}));
vi.mock('../gesture/run-gesture', () => ({
  runGesture: gesture.run,
  runHeldGesture: gesture.held,
  checkGesturePress: gesture.check,
}));

const box = vi.hoisted(() => ({
  current: null as TransformState | null,
  targets: ['a', 'b'] as string[],
  isCurrent: true,
  isLive: false,
  distortRefusal: null as { reason: string; notice: 'info' } | null,
  pending: (): TransformState | null => null,
  mode: (): TransformState['mode'] => 'free',
}));
vi.mock('../../app/interactions/layer-transform', () => ({
  // As the editor does: the pending transform while one is live, else an identity box in the mode pressed.
  getLayerTransformBox: () => box.pending() ?? (box.current && { ...box.current, mode: box.mode() }),
  currentLayerTransformTargets: () => box.targets,
  isLayerTransformCurrent: () => box.isCurrent,
  isLayerTransformLive: () => box.isLive,
  textInLayerTransformRefusal: (isDistorting: boolean) => (isDistorting ? box.distortRefusal : null),
}));
const modeButton = vi.hoisted(() => vi.fn());
vi.mock('../../app/interactions/move-transform-buttons', () => ({ setTransformModeFromMoveOptions: modeButton }));
const commit = vi.hoisted(() => vi.fn());
vi.mock('../../app/interactions/deselect-and-commit', () => ({ deselectAndCommit: commit }));
const textTarget = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../app/interactions/text-transform-handlers', () => ({ getTextTransformTarget: () => textTarget.current }));
const alpha = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../panels/LayerPanel/layer-selection', () => ({ selectLayerAlpha: alpha }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { createTransformState, computeDistort, computePerspective, computeSkew } = await import('../../tools/transform/transform');
const { CommandError } = await import('../command');
const { dragTransform } = await import('./transform-drag');

const BOX = createTransformState({ x: 100, y: 70, width: 60, height: 40 });
const raster = { id: 'a', name: 'Layer 1', type: 'raster', visible: true, locked: false } as unknown as Layer;
const measure = vi.fn(() => Promise.resolve());

/** A drag the Move tool's shared box takes: one history entry, and the turn the points give about the box centre. */
function takesDrag(effect: (input: GestureInput) => Partial<TransformState>) {
  return async (input: GestureInput, hold?: () => Promise<void>) => {
    await hold?.();
    useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never] });
    useUIStore.setState({ layerTransform: { ...BOX, ...effect(input) } });
    return { tool: 'move', layer: 'a' };
  };
}

function turnOf(input: GestureInput): number {
  const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
  return Math.atan2(r.y - 90, r.x - 130) - Math.atan2(p.y - 90, p.x - 130);
}

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  useEditorStore.setState({ undoStack: [] });
  useEditorStore.setState({ viewport: { ...useEditorStore.getState().viewport, zoom: 1 } });
  useUIStore.setState({ layerTransform: null, transform: null, showGrid: false, snapToGrid: false, layerTransformMode: 'free', textTransformMode: 'free', maskMode: 'off' });
  box.current = BOX;
  box.isCurrent = true;
  box.isLive = false;
  box.distortRefusal = null;
  box.pending = () => useUIStore.getState().layerTransform;
  box.mode = () => useUIStore.getState().layerTransformMode;
  textTarget.current = null;
  modeButton.mockReset().mockImplementation((mode: TransformState['mode'], isLayerBox: boolean) => {
    if (isLayerBox) useUIStore.setState({ layerTransformMode: mode });
    else useUIStore.setState({ transform: { ...BOX, mode } });
  });
  gesture.run.mockReset();
  gesture.held.mockReset().mockImplementation(takesDrag((input) => ({ rotation: turnOf(input) })));
  gesture.check.mockReset();
  commit.mockReset();
  alpha.mockClear();
});

describe('dragTransform on the shared box', () => {
  it('presses the rotate handle, holds until the session has begun, and commits as Escape does', async () => {
    const result = await dragTransform({ kind: 'rotate', angle: Math.PI / 6 }, true, raster, measure);
    expect(result.layers).toEqual(['a', 'b']);
    expect(result.outcome.rotate).toBeCloseTo(30, 4);
    const [input] = gesture.held.mock.calls[0]!;
    expect(input.tool).toBe('move');
    expect(input.points[0]).toEqual({ x: 180, y: 50 });
    expect(measure).toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(gesture.run).not.toHaveBeenCalled();
  });

  it('bakes a transform the UI left pending before it reads the box', async () => {
    box.isLive = true;
    await dragTransform({ kind: 'rotate', angle: 1 }, true, raster, measure);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('drags the handle opposite the anchor for a scale', async () => {
    gesture.held.mockImplementation(takesDrag(() => ({ scaleX: 2, scaleY: 0.5 })));
    const result = await dragTransform({ kind: 'scale', factor: { x: 2, y: 0.5 }, anchor: 'top-left' }, true, raster, measure);
    expect(result.outcome).toEqual({ scale: { x: 2, y: 0.5 } });
    expect(gesture.held.mock.calls[0]![0].points).toEqual([{ x: 160, y: 110 }, { x: 220, y: 90 }]);
  });

  it('refuses, without pressing, when snapping would change the angle or the release', async () => {
    useUIStore.setState({ showGrid: true, snapToGrid: true, gridSize: 16 });
    expect(await failure(dragTransform({ kind: 'rotate', angle: (20 * Math.PI) / 180 }, true, raster, measure))).toMatchObject({
      code: 'refused',
      message: expect.stringContaining('it would turn 15° instead of 20°'),
    });
    expect(await failure(dragTransform({ kind: 'scale', factor: { x: 1.1, y: 1.1 }, anchor: 'top-left' }, true, raster, measure))).toMatchObject({ code: 'refused' });
    expect(gesture.held).not.toHaveBeenCalled();
    await dragTransform({ kind: 'rotate', angle: Math.PI / 4 }, true, raster, measure);
    expect(gesture.held).toHaveBeenCalledTimes(1);
  });

  it('presses Free for a turn or a scale when another mode is pressed, and that mode again afterwards', async () => {
    useUIStore.setState({ layerTransformMode: 'distort' });
    await dragTransform({ kind: 'rotate', angle: Math.PI / 6 }, true, raster, measure);
    expect(modeButton.mock.calls).toEqual([['free', true], ['distort', true]]);
    expect(useUIStore.getState().layerTransformMode).toBe('distort');
    // Escape first, then the button: the mode button bakes a pending transform itself.
    expect(commit.mock.invocationCallOrder[0]!).toBeLessThan(modeButton.mock.invocationCallOrder[1]!);
  });

  it('puts the mode back when the step is refused after the button was pressed', async () => {
    box.current = null;
    expect((await failure(dragTransform({ kind: 'skew', tan: 0.5, anchor: 'top' }, true, raster, measure))).message).toContain('nothing to transform');
    expect(modeButton.mock.calls).toEqual([['skew', true], ['free', true]]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('skews in Skew mode: the edge opposite the anchor slides, and the shear is read back in degrees', async () => {
    gesture.held.mockImplementation(takesDrag((input) => {
      const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
      return computeSkew('bottom', p, r, { ...BOX, mode: 'skew' });
    }));
    const result = await dragTransform({ kind: 'skew', tan: 0.5, anchor: 'top' }, true, raster, measure);
    expect(gesture.held.mock.calls[0]![0].points).toEqual([{ x: 130, y: 110 }, { x: 150, y: 110 }]);
    expect(result.outcome.skew!.x).toBeCloseTo(26.565051, 6);
    expect(result.outcome.skew!.y).toBe(0);
    expect(modeButton.mock.calls).toEqual([['skew', true], ['free', true]]);
  });

  it('refuses a skew under half a pixel of travel without pressing, and treats the wrong shear as a bug', async () => {
    expect((await failure(dragTransform({ kind: 'skew', tan: 0.005, anchor: 'left' }, true, raster, measure))).message)
      .toContain('would slide the box\'s right edge by less than a pixel (the edge is 60 px from the one held)');
    expect(gesture.held).not.toHaveBeenCalled();
    gesture.held.mockImplementation(takesDrag(() => ({ skewY: 0 })));
    await expect(dragTransform({ kind: 'skew', tan: 0.5, anchor: 'left' }, true, raster, measure)).rejects.toThrow('the skew drag sheared by 0°');
  });

  it('distorts corner by corner on the same pending transform, each press on the handle where the last drag left it', async () => {
    gesture.held.mockImplementation(async (input: GestureInput) => {
      const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
      const state = useUIStore.getState().layerTransform ?? { ...BOX, mode: 'distort' as const };
      // Which corner the press is on, from the box as it stands.
      const handle = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).find((_, i) => {
        const base = [{ x: 100, y: 70 }, { x: 160, y: 70 }, { x: 160, y: 110 }, { x: 100, y: 110 }][i]!;
        return base.x + state.corners[i]!.x === p.x && base.y + state.corners[i]!.y === p.y;
      })!;
      useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never] });
      useUIStore.setState({ layerTransform: { ...state, corners: computeDistort(handle, p, r, state).corners } });
      return { tool: 'move', layer: 'a' };
    });
    const result = await dragTransform({
      kind: 'corners',
      mode: 'distort',
      drags: [{ handle: 'top-left', offset: { x: 10, y: 5 } }, { handle: 'bottom-right', offset: { x: 20, y: -4 } }],
    }, true, raster, measure);
    expect(gesture.held.mock.calls.map(([input]) => input.points)).toEqual([
      [{ x: 100, y: 70 }, { x: 110, y: 75 }],
      [{ x: 160, y: 110 }, { x: 180, y: 106 }],
    ]);
    expect(result.outcome).toEqual({
      corners: { 'top-left': { x: 10, y: 5 }, 'top-right': { x: 0, y: 0 }, 'bottom-right': { x: 20, y: -4 }, 'bottom-left': { x: 0, y: 0 } },
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
    expect(modeButton.mock.calls).toEqual([['distort', true], ['free', true]]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('in Perspective mode a corner drag is planned with the mirrored corner, as the handler moves it', async () => {
    gesture.held.mockImplementation(takesDrag((input) => {
      const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
      return { mode: 'perspective', corners: computePerspective('top-left', p, r, { ...BOX, mode: 'perspective' }).corners };
    }));
    const result = await dragTransform({ kind: 'corners', mode: 'perspective', drags: [{ handle: 'top-left', offset: { x: 12, y: -3 } }] }, true, raster, measure);
    expect(result.outcome.corners).toEqual({ 'top-left': { x: 12, y: -3 }, 'top-right': { x: -12, y: -3 }, 'bottom-right': { x: 0, y: 0 }, 'bottom-left': { x: 0, y: 0 } });
  });

  it('refuses corners that would fold the box or outgrow a document before the first press, and text with the editor\'s toast', async () => {
    const corners = (drags: Array<{ handle: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'; offset: { x: number; y: number } }>) =>
      dragTransform({ kind: 'corners', mode: 'distort', drags }, true, raster, measure);
    expect((await failure(corners([{ handle: 'top-left', offset: { x: 80, y: 60 } }]))).message)
      .toBe('These offsets would fold the box: its corners would be at (180, 130), (160, 70), (160, 110), (100, 110) (clockwise from the top-left), which is not a convex quad. Move the corners less.');
    expect((await failure(corners([{ handle: 'bottom-right', offset: { x: 20000, y: 20000 } }]))).message).toContain('larger than the largest document side');
    expect((await failure(corners([{ handle: 'bottom-right', offset: { x: 40000, y: 0 } }]))).message).toContain('outside the coordinate range');
    box.distortRefusal = { reason: 'Rasterize the text layers before distorting them with other layers.', notice: 'info' };
    expect(await failure(corners([{ handle: 'top-left', offset: { x: 5, y: 5 } }]))).toMatchObject({ notice: 'info', message: 'Rasterize the text layers before distorting them with other layers.' });
    expect(gesture.held).not.toHaveBeenCalled();
    // The mode button is pressed only once the text check has passed.
    expect(modeButton.mock.calls.filter(([mode]) => mode === 'distort')).toHaveLength(3);
  });

  it('treats a later corner press that was not taken as a bug, and says how many drags were made', async () => {
    let made = 0;
    gesture.held.mockImplementation(async (input: GestureInput) => {
      if (made++ > 0) return { tool: 'move', layer: 'a' };
      const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
      useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never] });
      useUIStore.setState({ layerTransform: { ...BOX, mode: 'distort', corners: computeDistort('top-left', p, r, { ...BOX, mode: 'distort' }).corners } });
      return { tool: 'move', layer: 'a' };
    });
    const pending = dragTransform({
      kind: 'corners',
      mode: 'distort',
      drags: [{ handle: 'top-left', offset: { x: 10, y: 5 } }, { handle: 'bottom-right', offset: { x: 20, y: -4 } }],
    }, true, raster, measure);
    await expect(pending).rejects.toThrow('distort drag 2 of 2 was not made');
    await expect(pending).rejects.not.toBeInstanceOf(CommandError);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('treats a corner drag that left other corners than planned as a bug', async () => {
    gesture.held.mockImplementation(takesDrag(() => ({ mode: 'distort' })));
    await expect(dragTransform({ kind: 'corners', mode: 'distort', drags: [{ handle: 'top-left', offset: { x: 10, y: 5 } }] }, true, raster, measure))
      .rejects.toThrow('a distort drag left the corners at');
  });

  it('refuses when no whole-pixel press lands on the handle at this zoom', async () => {
    box.current = createTransformState({ x: 100.5, y: 70.5, width: 60, height: 40 });
    useEditorStore.setState({ viewport: { ...useEditorStore.getState().viewport, zoom: 64 } });
    // A rotate handle keeps a hit radius of a whole pixel at any zoom; a scale handle's shrinks with it.
    expect((await failure(dragTransform({ kind: 'scale', factor: { x: 2, y: 2 }, anchor: 'top-left' }, true, raster, measure))).message).toContain('No whole-pixel press lands');
    expect(gesture.held).not.toHaveBeenCalled();
  });

  it('refuses a press the box did not take, and treats a drag that reached the wrong angle as a bug', async () => {
    gesture.held.mockImplementation(() => Promise.resolve({ tool: 'move', layer: 'a' }));
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, true, raster, measure))).message).toContain('not taken as a transform');
    gesture.held.mockImplementation(takesDrag(() => ({ rotation: 0 })));
    await expect(dragTransform({ kind: 'rotate', angle: 1 }, true, raster, measure)).rejects.toThrow('the rotate drag turned 0°');
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('refuses layer-mask edit mode and Quick Mask', async () => {
    useUIStore.setState({ maskMode: 'layerMask' });
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, true, raster, measure))).message).toContain('Leave mask edit mode');
    useUIStore.setState({ maskMode: 'quickMask' });
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, false, raster, measure))).message).toContain('Quick Mask is on');
  });
});

describe('dragTransform on one layer', () => {
  it('selects a raster layer\'s pixels first, as a Cmd-click on its thumbnail does, and drags the selection\'s box', async () => {
    alpha.mockImplementation(() => {
      const { width, height } = useEditorStore.getState().document;
      useEditorStore.getState().setSelection({ x: 100, y: 70, width: 60, height: 40 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
      useUIStore.setState({ transform: BOX });
      return Promise.resolve();
    });
    gesture.run.mockImplementation((input: GestureInput) => {
      useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never] });
      useUIStore.setState({ transform: { ...BOX, rotation: turnOf(input) } });
      return { tool: 'move', layer: 'a' };
    });
    const result = await dragTransform({ kind: 'rotate', angle: -Math.PI / 4 }, false, raster, measure);
    expect(alpha).toHaveBeenCalledWith('a');
    expect(result.layers).toEqual(['a']);
    expect(result.outcome.rotate).toBeCloseTo(-45, 4);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('presses the selection box\'s own mode button for a skew, and drops the box with the selection', async () => {
    alpha.mockImplementation(() => {
      const { width, height } = useEditorStore.getState().document;
      useEditorStore.getState().setSelection({ x: 100, y: 70, width: 60, height: 40 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
      useUIStore.setState({ transform: BOX });
      return Promise.resolve();
    });
    gesture.run.mockImplementation((input: GestureInput) => {
      const [p, r] = input.points as [{ x: number; y: number }, { x: number; y: number }];
      const state = useUIStore.getState().transform!;
      useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never] });
      useUIStore.setState({ transform: { ...state, ...computeSkew('right', p, r, state) } });
      return { tool: 'move', layer: 'a' };
    });
    const result = await dragTransform({ kind: 'skew', tan: 0.25, anchor: 'left' }, false, raster, measure);
    expect(modeButton.mock.calls).toEqual([['skew', false]]);
    expect(gesture.run.mock.calls[0]![0].points).toEqual([{ x: 160, y: 90 }, { x: 160, y: 105 }]);
    expect(result.outcome.skew).toEqual({ x: 0, y: expect.closeTo(14.036243, 5) });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('a text layer skews by its own Skew button, put back after, and has no Distort or Perspective', async () => {
    const text = { id: 't', name: 'T', type: 'text', visible: true, locked: false, transform: { a: 1, b: 0, c: 0, d: 1 } } as unknown as Layer;
    const frame = { anchor: { x: 100, y: 70 }, matrix: { a: 1, b: 0, c: 0, d: 1 }, box: { x: 0, y: 0, width: 60, height: 40 } };
    textTarget.current = { layer: text, frame, state: BOX };
    useEditorStore.setState({ document: { ...useEditorStore.getState().document, layers: [text], activeLayerId: 't' } });
    gesture.run.mockImplementation(() => {
      expect(useUIStore.getState().textTransformMode).toBe('skew');
      useEditorStore.setState({
        undoStack: [...useEditorStore.getState().undoStack, { label: 'Transform' } as never],
        document: { ...useEditorStore.getState().document, layers: [{ ...text, transform: { a: 1, b: 0, c: 0.5, d: 1 } } as unknown as Layer] },
      });
      return { tool: 'move', layer: 't' };
    });
    const result = await dragTransform({ kind: 'skew', tan: 0.5, anchor: 'top' }, false, text, measure);
    expect(gesture.run.mock.calls[0]![0].points).toEqual([{ x: 130, y: 110 }, { x: 150, y: 110 }]);
    expect(result.outcome.skew!.x).toBeCloseTo(26.565051, 6);
    expect(useUIStore.getState().textTransformMode).toBe('free');
    expect(commit).not.toHaveBeenCalled();

    for (const mode of ['distort', 'perspective'] as const) {
      const refused = await failure(dragTransform({ kind: 'corners', mode, drags: [{ handle: 'top-left', offset: { x: 5, y: 5 } }] }, false, text, measure));
      expect(refused).toMatchObject({ code: 'refused', notice: null });
      expect(refused.message).toContain('only its Free and Skew modes: rasterize "T" (layer.rasterize)');
    }
    expect(gesture.run).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty layer, text on a path, hidden text, and other layer types', async () => {
    useEditorStore.getState().clearSelection();
    alpha.mockImplementation(() => Promise.resolve());
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, false, raster, measure))).message).toBe('"Layer 1" has no pixels on the canvas to transform.');
    const text = { id: 't', name: 'T', type: 'text', visible: true, locked: false } as unknown as Layer;
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, false, { ...text, pathId: 'p' } as Layer, measure))).message).toContain('text on a path');
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, false, { ...text, visible: false } as Layer, measure))).message).toContain('is hidden');
    const shape = { id: 's', name: 'S', type: 'shape' } as unknown as Layer;
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, false, shape, measure))).message).toContain('shape layer');
    expect(gesture.run).not.toHaveBeenCalled();
  });
});
