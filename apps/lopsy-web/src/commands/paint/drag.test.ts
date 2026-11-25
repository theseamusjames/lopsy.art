// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolEvent } from '../../app/interactions/gesture-session';

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

const gesture = vi.hoisted(() => ({ down: vi.fn(), move: vi.fn(), up: vi.fn() }));
vi.mock('../../app/interactions/gesture-session', () => ({
  gestureDown: gesture.down,
  gestureMove: gesture.move,
  gestureUp: gesture.up,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./drag');

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

function selectBox(x: number, y: number, w: number, h: number): void {
  const { width, height } = useEditorStore.getState().document;
  const inside = (i: number): boolean => {
    const px = i % width;
    const py = Math.floor(i / width);
    return px >= x && px < x + w && py >= y && py < y + h;
  };
  const mask = Uint8ClampedArray.from({ length: width * height }, (_, i) => (inside(i) ? 255 : 0));
  useEditorStore.getState().setSelection({ x, y, width: w, height: h }, mask, width, height);
}

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  useUIStore.getState().setMaskEditMode(false);
  const ts = useToolSettingsStore.getState();
  ts.setShapeSetting('output', 'pixels');
  ts.setSymmetryHorizontal(false);
  gesture.down.mockReset();
  gesture.move.mockReset();
  gesture.up.mockReset();
});

describe('paint.gradient', () => {
  it('drags the Gradient tool from `from` to `to` in the synchronous part', async () => {
    const pending = runCommand('paint.gradient', { from: { x: 2, y: 3 }, to: { x: 20, y: 10 } });
    expect(useUIStore.getState().activeTool).toBe('gradient');
    expect(eventAt(gesture.down)).toMatchObject({ clientX: 2, clientY: 3 });
    expect(eventAt(gesture.move)).toMatchObject({ clientX: 20, clientY: 10 });
    expect(eventAt(gesture.up)).toMatchObject({ clientX: 20, clientY: 10 });
    await expect(pending).resolves.toEqual({ tool: 'gradient', layer: activeId() });
  });

  it('refuses a drag that lands on one pixel, and a text layer', async () => {
    expect(await failure(runCommand('paint.gradient', { from: { x: 2.2, y: 3 }, to: { x: 1.9, y: 3.4 } }))).toMatchObject({
      code: 'invalid',
      message: 'paint.gradient: from and to land on the same pixel; a click without a drag draws nothing.',
    });
    patchActive({ type: 'text' });
    expect(await failure(runCommand('paint.gradient', { from: { x: 2, y: 3 }, to: { x: 9, y: 3 } }))).toMatchObject({
      code: 'refused',
      message: 'Text layers must be rasterized before they can be painted on.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
  });
});

describe('paint.shape', () => {
  it('drags the Shape tool, with Cmd for constrain, and reports pixel output', async () => {
    const pending = runCommand('paint.shape', { from: { x: 10, y: 10 }, to: { x: 20, y: 25 }, constrain: true });
    expect(eventAt(gesture.down)).toMatchObject({ clientX: 10, clientY: 10, metaKey: true });
    expect(eventAt(gesture.up)).toMatchObject({ clientX: 20, clientY: 25, metaKey: true });
    await expect(pending).resolves.toEqual({ tool: 'shape', layer: activeId(), output: 'pixels', path: null });
  });

  it('returns the path the gesture added with path output', async () => {
    useToolSettingsStore.getState().setShapeSetting('output', 'path');
    gesture.up.mockImplementation(() => useEditorStore.getState().addPath([], true));
    const result = await runCommand('paint.shape', { from: { x: 10, y: 10 }, to: { x: 20, y: 25 } });
    expect(result).toEqual({ tool: 'shape', layer: activeId(), output: 'path', path: useEditorStore.getState().selectedPathId });
  });

  it('refuses a click-length drag, a flat box, and Cmd with symmetry on', async () => {
    expect(await failure(runCommand('paint.shape', { from: { x: 10, y: 10 }, to: { x: 12, y: 12 } }))).toMatchObject({
      code: 'invalid',
      message: 'paint.shape: from and to must be at least 4 px apart; a shorter drag is a click, which opens the Shape Size dialog in the UI.',
    });
    expect(await failure(runCommand('paint.shape', { from: { x: 10, y: 10 }, to: { x: 10, y: 25 } }))).toMatchObject({
      code: 'invalid',
      message: 'paint.shape: from and to must differ in both x and y, or the shape has no width or height.',
    });
    useToolSettingsStore.getState().setSymmetryHorizontal(true);
    expect(await failure(runCommand('paint.shape', { from: { x: 10, y: 10 }, to: { x: 20, y: 25 }, constrain: true }))).toMatchObject({
      code: 'refused',
      message: 'With symmetry on, the Cmd/Ctrl press that constrains a shape sets the symmetry centre instead: turn symmetry off to draw a constrained shape.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
  });
});

describe('paint.bucket', () => {
  it('clicks the Paint Bucket in the synchronous part', async () => {
    const pending = runCommand('paint.bucket', { x: 5.5, y: 6 });
    expect(useUIStore.getState().activeTool).toBe('fill');
    expect(eventAt(gesture.down)).toMatchObject({ clientX: 5.5, clientY: 6 });
    expect(gesture.move).not.toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ tool: 'fill', layer: activeId() });
  });

  it('refuses a pixel outside the document, outside the selection, and a group', async () => {
    expect(await failure(runCommand('paint.bucket', { x: 40, y: 1 }))).toMatchObject({
      code: 'refused',
      message: '(40, 1) is outside the 40x30 document: a Paint Bucket click there fills nothing.',
    });
    selectBox(0, 0, 10, 10);
    expect(await failure(runCommand('paint.bucket', { x: 15, y: 15 }))).toMatchObject({
      code: 'refused',
      message: '(15, 15) is outside the selection: the Paint Bucket fills only inside it, and a click outside does nothing.',
    });
    patchActive({ type: 'group' });
    expect(await failure(runCommand('paint.bucket', { x: 5, y: 5 }))).toMatchObject({ code: 'refused' });
    expect(gesture.down).not.toHaveBeenCalled();
  });

  it('lets a press outside the selection through in Quick Mask mode, where it floods the mask', async () => {
    selectBox(0, 0, 10, 10);
    useUIStore.setState({ maskMode: 'quickMask' });
    await runCommand('paint.bucket', { x: 15, y: 15 });
    expect(gesture.down).toHaveBeenCalledTimes(1);
    useUIStore.setState({ maskMode: 'off' });
  });
});
