// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolEvent } from '../../app/interactions/gesture-session';
import type { TransformState } from '../../tools/transform/transform';
import type { Rect } from '../../types';

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

// A named layer that is not active is acted on once the engine has settled (context.ts actOnLayer); there is no render loop here.
const settle = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../settled', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settled')>()),
  settled: () => {
    settle.calls++;
    return Promise.resolve();
  },
}));

const engine = { current: {} as unknown };
vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => engine.current };
});

const gesture = vi.hoisted(() => ({ down: vi.fn(), move: vi.fn(), up: vi.fn() }));
vi.mock('../../app/interactions/gesture-session', () => ({
  gestureDown: gesture.down,
  gestureMove: gesture.move,
  gestureUp: gesture.up,
  clearPersistentTransform: vi.fn(),
}));

const boxes = vi.hoisted(() => ({
  layer: { current: null as TransformState | null },
  hit: vi.fn((): string | null => null),
}));
vi.mock('../../app/interactions/layer-transform', () => ({ getLayerTransformBox: () => boxes.layer.current }));
vi.mock('../../app/interactions/text-transform-handlers', () => ({ getTextTransformTarget: () => null }));
vi.mock('../../app/interactions/transform-handlers', () => ({ hitTestTransformHandle: boxes.hit }));

const content = vi.hoisted(() => ({
  peek: vi.fn((): Rect | null | undefined => null),
  read: vi.fn((): Promise<Rect | null> => Promise.resolve(null)),
}));
vi.mock('../../app/layer-content-rect', () => ({
  peekLayerContentRectLocal: content.peek,
  readLayerContentRectLocal: content.read,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { createTransformState } = await import('../../tools/transform/transform');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./move');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function activeId(): string {
  return useEditorStore.getState().document.activeLayerId ?? '';
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = useEditorStore.getState().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
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

function eventAt(fn: typeof gesture.down): ToolEvent {
  const call = fn.mock.calls[0];
  if (!call) throw new Error('not called');
  return call[0] as ToolEvent;
}

/** What a whole-layer Move drag does to the store, applied by the mocked release. */
function moveOnRelease(dx: number, dy: number): void {
  gesture.up.mockImplementation(() => {
    const id = activeId();
    const layer = useEditorStore.getState().document.layers.find((l) => l.id === id)!;
    useEditorStore.getState().updateLayerPosition(id, layer.x + dx, layer.y + dy);
  });
}

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  boxes.layer.current = createTransformState({ x: 10, y: 6, width: 10, height: 8 });
  boxes.hit.mockReset().mockReturnValue(null);
  content.peek.mockReset().mockReturnValue(null);
  content.read.mockReset().mockResolvedValue(null);
  gesture.down.mockReset();
  gesture.move.mockReset();
  gesture.up.mockReset();
});

describe('layer.move', () => {
  it('drags the Move tool from the layer box\'s centre by (dx, dy) in the synchronous part and reports the position', async () => {
    moveOnRelease(5, -3);
    const pending = runCommand('layer.move', { dx: 5, dy: -3 });
    expect(useUIStore.getState().activeTool).toBe('move');
    expect(eventAt(gesture.down)).toMatchObject({ clientX: 15, clientY: 10, shiftKey: false, altKey: false, metaKey: false });
    expect(eventAt(gesture.move)).toMatchObject({ clientX: 20, clientY: 7 });
    expect(eventAt(gesture.up)).toMatchObject({ clientX: 20, clientY: 7 });
    await expect(pending).resolves.toEqual({ layer: activeId(), x: 5, y: -3 });
    expect(content.read).not.toHaveBeenCalled();
  });

  it('presses away from the box when its centre is on a handle', async () => {
    boxes.hit.mockReturnValueOnce('top-left');
    await runCommand('layer.move', { dx: 1, dy: 0 });
    const press = eventAt(gesture.down);
    expect(press.clientX).toBe(15);
    expect(press.clientY).toBeLessThan(6);
  });

  it('presses at the document centre when the layer has no box, and refuses when no point is clear', async () => {
    boxes.layer.current = null;
    await runCommand('layer.move', { dx: 1, dy: 1 });
    expect(eventAt(gesture.down)).toMatchObject({ clientX: 20, clientY: 15 });
    gesture.down.mockReset();
    boxes.layer.current = createTransformState({ x: 10, y: 6, width: 10, height: 8 });
    boxes.hit.mockReturnValue('top');
    expect(await failure(runCommand('layer.move', { dx: 1, dy: 1 }))).toMatchObject({ code: 'refused' });
    expect(gesture.down).not.toHaveBeenCalled();
  });

  it('waits for a press held on the layer\'s content bounds, and reports where the drag left it', async () => {
    let measured: (rect: Rect | null) => void = () => {};
    const read = new Promise<Rect | null>((resolve) => { measured = resolve; });
    content.peek.mockReturnValue(undefined);
    content.read.mockReturnValue(read);
    gesture.down.mockImplementation(() => {
      void Promise.all([read]).then(() => {
        const id = activeId();
        useEditorStore.getState().updateLayerPosition(id, 7, 9);
      });
    });
    const pending = runCommand('layer.move', { dx: 7, dy: 9 });
    let isDone = false;
    void pending.then(() => { isDone = true; });
    await Promise.resolve();
    expect(isDone).toBe(false);
    measured(null);
    await expect(pending).resolves.toEqual({ layer: activeId(), x: 7, y: 9 });
  });

  it('makes a named layer active first', async () => {
    const first = activeId();
    useEditorStore.getState().addLayer();
    expect(activeId()).not.toBe(first);
    await runCommand('layer.move', { layer: first, dx: 2, dy: 0 });
    expect(activeId()).toBe(first);
  });

  it('refuses a zero offset, fractions, an active selection, a locked layer and an unknown layer', async () => {
    expect(await failure(runCommand('layer.move', { dx: 0, dy: 0 }))).toMatchObject({
      code: 'invalid',
      message: 'layer.move: dx and dy are both 0; a Move click without a drag moves nothing.',
    });
    expect((await failure(runCommand('layer.move', { dx: 0.5, dy: 0 }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.move', { layer: 'nope', dx: 1, dy: 0 }))).code).toBe('not-found');
    const { width, height } = useEditorStore.getState().document;
    useEditorStore.getState().setSelection({ x: 0, y: 0, width: 4, height: 4 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
    expect(await failure(runCommand('layer.move', { dx: 1, dy: 0 }))).toMatchObject({
      code: 'refused',
      message: 'A selection is active, and a Move drag would lift the selected pixels instead of moving the layer: deselect first (select.none), or drag the selection with tool.gesture and the move tool.',
    });
    useEditorStore.getState().clearSelection();
    patchActive({ locked: true });
    expect(await failure(runCommand('layer.move', { dx: 1, dy: 0 }))).toMatchObject({
      code: 'refused',
      message: '"Layer 1" is locked: unlock it to use the Move tool on it.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
  });
});
