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
}));
vi.mock('../../app/interactions/layer-transform', () => ({
  getLayerTransformBox: () => box.current,
  currentLayerTransformTargets: () => box.targets,
  isLayerTransformCurrent: () => box.isCurrent,
  isLayerTransformLive: () => box.isLive,
  textInLayerTransformRefusal: () => null,
}));
const commit = vi.hoisted(() => vi.fn());
vi.mock('../../app/interactions/deselect-and-commit', () => ({ deselectAndCommit: commit }));
vi.mock('../../app/interactions/text-transform-handlers', () => ({ getTextTransformTarget: () => null }));
const alpha = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../panels/LayerPanel/layer-selection', () => ({ selectLayerAlpha: alpha }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { createTransformState } = await import('../../tools/transform/transform');
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
  useUIStore.setState({ layerTransform: null, transform: null, showGrid: false, snapToGrid: false, layerTransformMode: 'free', maskMode: 'off' });
  box.current = BOX;
  box.isCurrent = true;
  box.isLive = false;
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

  it('refuses a mode whose handles do something else', async () => {
    useUIStore.setState({ layerTransformMode: 'skew' });
    expect((await failure(dragTransform({ kind: 'scale', factor: { x: 2, y: 2 }, anchor: 'top-left' }, true, raster, measure))).message).toContain('Skew mode');
    useUIStore.setState({ layerTransformMode: 'distort' });
    expect((await failure(dragTransform({ kind: 'rotate', angle: 1 }, true, raster, measure))).message).toContain('no rotate handles');
    expect(gesture.held).not.toHaveBeenCalled();
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
