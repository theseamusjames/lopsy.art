// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractionState, ToolHandler } from '../../app/interactions/interaction-types';

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
vi.mock('../../engine-wasm/wasm-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/wasm-bridge')>();
  return { ...actual, beginStroke: vi.fn(), endStroke: vi.fn(), hasFloat: vi.fn(() => false) };
});
vi.mock('../../engine-wasm/engine-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-sync')>();
  return { ...actual, syncDocumentSize: vi.fn(), flushLayerSync: vi.fn(), syncSelection: vi.fn() };
});
vi.mock('../../app/sync-layer-after-full-size', () => ({ syncLayerAfterFullSize: () => null }));
vi.mock('../../app/store/history-slice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/store/history-slice')>();
  return { ...actual, deferCacheLayerSnapshot: vi.fn() };
});

/** A brush whose press returns a stroke long enough for hold-to-smooth to arm on the next move. */
const brush = vi.hoisted(() => ({
  down: vi.fn(),
  move: vi.fn(),
}));
vi.mock('../../app/interactions/tool-router', () => ({
  toolHandlers: { brush: brush as ToolHandler },
  handleTransformMove: vi.fn(),
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { INITIAL_INTERACTION_STATE } = await import('../../app/interactions/interaction-types');
const { gestureDown, gestureMove, gestureUp, resetGestureSessionForTest } = await import('../../app/interactions/gesture-session');
const { documentEnvironment, runGesture } = await import('./run-gesture');

const POINTS = [{ x: 5, y: 5 }, { x: 10, y: 8 }, { x: 15, y: 12 }];

function strokeState(layerId: string): InteractionState {
  return {
    ...INITIAL_INTERACTION_STATE,
    drawing: true,
    tool: 'brush',
    layerId,
    lastPoint: { x: 15, y: 12 },
    strokePoints: [{ x: 5, y: 5 }, { x: 10, y: 8 }, { x: 15, y: 12 }],
  };
}

function press(x: number, y: number) {
  return { clientX: x, clientY: y, button: 0, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  resetGestureSessionForTest();
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  useEditorStore.setState({ pushHistory: vi.fn() });
  useUIStore.getState().setActiveTool('brush');
  const layerId = useEditorStore.getState().document.activeLayerId ?? '';
  brush.down.mockReset().mockImplementation(() => strokeState(layerId));
  brush.move.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('runGesture and hold-to-smooth', () => {
  it('arms the hold timer on a brush move while the button is down (the control)', () => {
    gestureDown(press(5, 5), documentEnvironment);
    gestureMove(press(10, 8), documentEnvironment);
    expect(vi.getTimerCount()).toBe(1);
    gestureUp(press(10, 8), documentEnvironment);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer pending once the runner returns, since its release comes in the same tick', () => {
    runGesture({ tool: 'brush', points: POINTS });
    expect(brush.move).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(useEditorStore.getState().pushHistory).toHaveBeenCalledTimes(1);
  });
});
