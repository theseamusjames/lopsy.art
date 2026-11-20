// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const { runCommand } = await import('../registry');
await import('./gesture');

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  gesture.down.mockReset();
  gesture.move.mockReset();
  gesture.up.mockReset();
});

describe('tool.gesture', () => {
  it('passes the tool, points, modifiers and click count straight to the runner, synchronously', async () => {
    const pending = runCommand('tool.gesture', { tool: 'text', points: [{ x: 4, y: 5 }], shift: true, meta: true, clicks: 2 });
    expect(useUIStore.getState().activeTool).toBe('text');
    expect(gesture.down).toHaveBeenCalledWith(
      expect.objectContaining({ clientX: 4, clientY: 5, shiftKey: true, altKey: false, metaKey: true, detail: 2 }),
      expect.anything(),
    );
    expect(gesture.up).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({ tool: 'text', layer: useEditorStore.getState().document.activeLayerId });
  });

  it('uses the active tool when none is given, and checks clicks and points', async () => {
    await expect(runCommand('tool.gesture', { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).resolves.toMatchObject({ tool: 'brush' });
    await expect(runCommand('tool.gesture', { points: [{ x: 1, y: 1 }], clicks: 4 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(runCommand('tool.gesture', { points: [] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(runCommand('tool.gesture', { tool: 'burn', points: [{ x: 1, y: 1 }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(gesture.down).toHaveBeenCalledTimes(1);
  });
});
