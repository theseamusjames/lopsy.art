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
const { stampSourceState } = await import('../../tools/common/stamp-source-state');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./stroke');

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

function pressed(index = 0): ToolEvent {
  const call = gesture.down.mock.calls[index];
  if (!call) throw new Error(`no press ${index}`);
  return call[0] as ToolEvent;
}

const POINTS = [{ x: 1, y: 2 }, { x: 5, y: 6 }];

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('move');
  useUIStore.setState({ lastPaintPoint: null });
  stampSourceState.source = null;
  gesture.down.mockReset();
  gesture.move.mockReset();
  gesture.up.mockReset();
});

describe('paint.stroke', () => {
  it('runs the stroke through the gesture dispatcher in the synchronous part, with the brush by default', async () => {
    const pending = runCommand('paint.stroke', { points: POINTS });
    expect(useUIStore.getState().activeTool).toBe('brush');
    expect(pressed()).toMatchObject({ clientX: 1, clientY: 2, shiftKey: false, altKey: false });
    expect(gesture.move).toHaveBeenCalledTimes(1);
    expect(gesture.up).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({ tool: 'brush', layer: activeId(), line: false });
  });

  it('holds Shift for a line, and reports a line only when the layer has a previous stroke end', async () => {
    await expect(runCommand('paint.stroke', { points: [{ x: 3, y: 3 }], line: true })).resolves.toMatchObject({ line: false });
    expect(pressed().shiftKey).toBe(true);
    useUIStore.getState().setLastPaintPoint({ point: { x: 1, y: 1 }, layerId: activeId() });
    await expect(runCommand('paint.stroke', { tool: 'pencil', points: [{ x: 3, y: 3 }], line: true })).resolves.toEqual({
      tool: 'pencil', layer: activeId(), line: true,
    });
    useUIStore.getState().setLastPaintPoint({ point: { x: 1, y: 1 }, layerId: 'another-layer' });
    await expect(runCommand('paint.stroke', { points: [{ x: 3, y: 3 }], line: true })).resolves.toMatchObject({ line: false });
  });

  it('Alt-clicks the clone source before the stroke for stamp and healing', async () => {
    await runCommand('paint.stroke', { tool: 'healing', points: POINTS, source: { x: 9, y: 9 } });
    expect(gesture.down).toHaveBeenCalledTimes(2);
    expect(pressed(0)).toMatchObject({ clientX: 9, clientY: 9, altKey: true });
    expect(pressed(1)).toMatchObject({ clientX: 1, clientY: 2, altKey: false });
    expect(gesture.up).toHaveBeenCalledTimes(2);
  });

  it('uses the source already set when none is passed', async () => {
    stampSourceState.source = { x: 4, y: 4 };
    await runCommand('paint.stroke', { tool: 'stamp', points: POINTS });
    expect(gesture.down).toHaveBeenCalledTimes(1);
  });

  it('refuses stamp with no source, and a source for other tools', async () => {
    expect(await failure(runCommand('paint.stroke', { tool: 'stamp', points: POINTS }))).toMatchObject({
      code: 'refused',
      message: 'No clone source is set for the stamp tool: pass source, the point to sample from, as an Alt-click sets it in the UI.',
    });
    expect(await failure(runCommand('paint.stroke', { tool: 'eraser', points: POINTS, source: { x: 1, y: 1 } }))).toMatchObject({
      code: 'invalid',
      message: 'paint.stroke: source is only for the stamp and healing tools, not eraser.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
  });

  it('does not offer spray, and takes 1 to 10000 points', async () => {
    expect((await failure(runCommand('paint.stroke', { tool: 'spray', points: POINTS }))).code).toBe('invalid');
    expect((await failure(runCommand('paint.stroke', { points: [] }))).code).toBe('invalid');
    const tooMany = Array.from({ length: 10_001 }, () => ({ x: 1, y: 1 }));
    expect((await failure(runCommand('paint.stroke', { points: tooMany }))).code).toBe('invalid');
  });

  it('refuses a locked layer before pressing', async () => {
    patchActive({ locked: true });
    expect(await failure(runCommand('paint.stroke', { points: POINTS }))).toMatchObject({
      code: 'refused',
      message: '"Layer 1" is locked: unlock it to use the Brush tool on it.',
    });
    expect(gesture.down).not.toHaveBeenCalled();
  });
});
