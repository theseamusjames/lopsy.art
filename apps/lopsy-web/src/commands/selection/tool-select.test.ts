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
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./tool-select');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function press(): ToolEvent {
  const call = gesture.down.mock.calls[0];
  if (!call) throw new Error('not pressed');
  return call[0] as ToolEvent;
}

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setActiveTool('brush');
  gesture.down.mockReset();
  gesture.move.mockReset();
  gesture.up.mockReset();
});

describe('select.wand', () => {
  it.each([
    ['replace', false, false],
    ['add', true, false],
    ['subtract', false, true],
    ['intersect', true, true],
  ] as const)('clicks the Magic Wand with the %s modifiers in the synchronous part', async (mode, shiftKey, altKey) => {
    const pending = runCommand('select.wand', { x: 3, y: 4, mode });
    expect(useUIStore.getState().activeTool).toBe('wand');
    expect(press()).toMatchObject({ clientX: 3, clientY: 4, shiftKey, altKey });
    expect(gesture.up).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({ tool: 'wand' });
  });

  it('works on a locked layer, and refuses a pixel outside the document', async () => {
    const doc = useEditorStore.getState().document;
    const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, locked: true } as Layer) : l));
    useEditorStore.setState({ document: { ...doc, layers } });
    await runCommand('select.wand', { x: 3, y: 4 });
    expect(gesture.down).toHaveBeenCalledTimes(1);
    expect(await failure(runCommand('select.wand', { x: 3, y: 30 }))).toMatchObject({
      code: 'refused',
      message: '(3, 30) is outside the 40x30 document: a Magic Wand click there selects nothing.',
    });
    expect((await failure(runCommand('select.wand', { x: 3, y: 4, mode: 'xor' }))).code).toBe('invalid');
  });
});

describe('select.quick', () => {
  it('drags Quick Selection through the points with no modifiers', async () => {
    const pending = runCommand('select.quick', { points: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 2 }] });
    expect(useUIStore.getState().activeTool).toBe('quick-select');
    expect(press()).toMatchObject({ clientX: 1, clientY: 1, shiftKey: false, altKey: false });
    expect(gesture.move).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toEqual({ tool: 'quick-select' });
    expect((await failure(runCommand('select.quick', { points: [] }))).code).toBe('invalid');
  });
});
