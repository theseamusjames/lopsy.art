// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransformState } from '../../tools/transform/transform';

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

vi.mock('../../app/interactions/gesture-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/interactions/gesture-session')>();
  return { ...actual, clearPersistentTransform: vi.fn() };
});

const pushed: string[] = [];
const buttons = vi.hoisted(() => ({
  rotate: vi.fn((): Promise<void> => Promise.resolve()),
  flip: vi.fn((): Promise<void> => Promise.resolve()),
  wantsBox: vi.fn(() => false),
}));
vi.mock('../../app/interactions/move-transform-buttons', () => ({
  rotateFromMoveOptions: buttons.rotate,
  flipFromMoveOptions: buttons.flip,
  wantsLayerTransform: buttons.wantsBox,
}));

const box = vi.hoisted(() => ({
  current: null as TransformState | null,
  targets: [] as string[],
  textRefusal: null as { reason: string; notice: 'info' } | null,
}));
vi.mock('../../app/interactions/layer-transform', () => ({
  getLayerTransformBox: () => box.current,
  currentLayerTransformTargets: () => box.targets,
  textInLayerTransformRefusal: () => box.textRefusal,
}));
const read = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const drag = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./transform-drag', () => ({ dragTransform: drag.run }));
vi.mock('../../app/layer-content-rect', () => ({ readLayerContentRectLocal: read }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { createTransformState } = await import('../../tools/transform/transform');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./transform');

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function pushOnStep(label: string): () => Promise<void> {
  return () => {
    useEditorStore.setState({ undoStack: [...useEditorStore.getState().undoStack, { label } as never] });
    pushed.push(label);
    return Promise.resolve();
  };
}

function ids(): string[] {
  return useEditorStore.getState().document.layers.filter((l) => l.type === 'raster').map((l) => l.id);
}

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  pushed.length = 0;
  buttons.rotate.mockReset().mockImplementation(pushOnStep('Rotate Layer 90° CW'));
  buttons.flip.mockReset().mockImplementation(pushOnStep('Transform'));
  buttons.wantsBox.mockReset().mockReturnValue(false);
  box.current = null;
  box.targets = [];
  box.textRefusal = null;
  read.mockClear();
  drag.run.mockReset().mockImplementation((step: { kind: string }, _isBox: boolean, layer: { id: string }) => Promise.resolve({
    layers: [layer.id],
    outcome: step.kind === 'rotate' ? { rotate: 30 } : { scale: { x: 2, y: 2 } },
  }));
});

describe('layer.transform', () => {
  it('turns one layer with the Move options rotate button, selecting the Move tool first', async () => {
    const id = useEditorStore.getState().document.activeLayerId;
    await expect(runCommand('layer.transform', { rotate: -90 })).resolves.toEqual({ layers: [id] });
    expect(useUIStore.getState().activeTool).toBe('move');
    expect(buttons.rotate).toHaveBeenCalledWith('ccw');
  });

  it('selects several layers as a click and Cmd-click do, and steps their shared box once its bounds are read', async () => {
    useEditorStore.getState().addLayer();
    const [first, second] = ids();
    buttons.wantsBox.mockReturnValue(true);
    box.targets = [first!, second!];
    box.current = createTransformState({ x: 0, y: 0, width: 10, height: 10 });
    await expect(runCommand('layer.transform', { layers: [first!, second!], flip: 'vertical' })).resolves.toEqual({ layers: [first, second] });
    const doc = useEditorStore.getState().document;
    expect(doc.activeLayerId).toBe(first);
    expect([...doc.selectedLayerIds].sort()).toEqual([first, second].sort());
    expect(read).toHaveBeenCalledTimes(2);
    expect(buttons.flip).toHaveBeenCalledWith('vertical', true);
  });

  it('refuses text the shared box cannot keep live, and a box with nothing in it', async () => {
    buttons.wantsBox.mockReturnValue(true);
    box.textRefusal = { reason: 'Rasterize text on a path before transforming it with other layers.', notice: 'info' };
    expect(await failure(runCommand('layer.transform', { rotate: 90 }))).toMatchObject({ code: 'refused', notice: 'info' });
    box.textRefusal = null;
    expect(await failure(runCommand('layer.transform', { rotate: 90 }))).toMatchObject({ code: 'refused', message: 'The selected layers have nothing to transform: they are empty or locked.' });
    expect(buttons.rotate).not.toHaveBeenCalled();
  });

  it('refuses a flip of one raster layer, a marquee, and a step that changed nothing', async () => {
    expect(await failure(runCommand('layer.transform', { flip: 'horizontal' }))).toMatchObject({ code: 'refused' });
    buttons.rotate.mockImplementationOnce(() => Promise.resolve());
    expect(await failure(runCommand('layer.transform', { rotate: 90 }))).toMatchObject({
      code: 'refused',
      message: 'Nothing was transformed: the layers have no content to turn or flip.',
    });
    const { width, height } = useEditorStore.getState().document;
    useEditorStore.getState().setSelection({ x: 0, y: 0, width: 4, height: 4 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
    expect(await failure(runCommand('layer.transform', { rotate: 90 }))).toMatchObject({ code: 'refused' });
    expect(buttons.flip).not.toHaveBeenCalled();
  });

  it('takes exactly one of rotate, flip or scale', async () => {
    expect((await failure(runCommand('layer.transform', {}))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { rotate: 90, flip: 'horizontal' }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { rotate: 30, scale: { x: 2, y: 2 } }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { rotate: 0 }))).message).toBe('layer.transform: rotate 0 turns nothing.');
    expect((await failure(runCommand('layer.transform', { rotate: 360 }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { rotate: 361 }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { scale: { x: 0.01, y: 1 } }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { scale: { x: 1, y: 1 } }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.transform', { scale: { x: 2, y: 2 }, anchor: 'top' }))).message).toContain('scales only y');
    expect((await failure(runCommand('layer.transform', { rotate: 30, anchor: 'top' }))).message).toBe('layer.transform: anchor goes with scale only.');
    expect((await failure(runCommand('layer.transform', { layer: 'Layer 1', layers: ['a', 'b'], rotate: 90 }))).code).toBe('invalid');
    expect(drag.run).not.toHaveBeenCalled();
  });

  it('drags a handle for any other angle, in radians, with the Move tool selected', async () => {
    const id = useEditorStore.getState().document.activeLayerId;
    await expect(runCommand('layer.transform', { rotate: 180 })).resolves.toEqual({ layers: [id], rotate: 30 });
    expect(useUIStore.getState().activeTool).toBe('move');
    const [step, isBox, layer] = drag.run.mock.calls[0]!;
    expect(step).toEqual({ kind: 'rotate', angle: Math.PI });
    expect(isBox).toBe(false);
    expect(layer).toMatchObject({ id });
    expect(buttons.rotate).not.toHaveBeenCalled();
  });

  it('drags a scale handle, from the top-left by default, and through the shared box for several layers', async () => {
    await runCommand('layer.transform', { scale: { x: 2, y: 0.5 } });
    expect(drag.run.mock.calls[0]![0]).toEqual({ kind: 'scale', factor: { x: 2, y: 0.5 }, anchor: 'top-left' });
    useEditorStore.getState().addLayer();
    const [first, second] = ids();
    buttons.wantsBox.mockReturnValue(true);
    box.targets = [first!, second!];
    box.current = createTransformState({ x: 0, y: 0, width: 10, height: 10 });
    await runCommand('layer.transform', { layers: [first!, second!], scale: { x: 1, y: 3 }, anchor: 'bottom' });
    const [step, isBox, , measure] = drag.run.mock.calls[1]!;
    expect(step).toEqual({ kind: 'scale', factor: { x: 1, y: 3 }, anchor: 'bottom' });
    expect(isBox).toBe(true);
    await (measure as () => Promise<void>)();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refuses a drag while a marquee is active, as it refuses the buttons', async () => {
    const { width, height } = useEditorStore.getState().document;
    useEditorStore.getState().setSelection({ x: 0, y: 0, width: 4, height: 4 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
    expect(await failure(runCommand('layer.transform', { rotate: 45 }))).toMatchObject({ code: 'refused', message: expect.stringContaining('A marquee is active') });
    expect(await failure(runCommand('layer.transform', { scale: { x: 2, y: 2 } }))).toMatchObject({ code: 'refused' });
    expect(drag.run).not.toHaveBeenCalled();
  });
});
