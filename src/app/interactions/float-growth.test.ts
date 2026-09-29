// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Engine } from '../../engine-wasm/wasm-bridge';

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  ensureFloatCovers: vi.fn(() => new Int32Array([0, 0, 600, 500])),
  getLayerEngineBounds: vi.fn(() => new Int32Array([0, 0, 600, 500])),
}));

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

const { useEditorStore } = await import('../editor-store');
const { pixelDataManager } = await import('../../engine/pixel-data-manager');
const { growFloatToCover } = await import('./float-growth');
const { createRasterLayer } = await import('../../layers/layer-model');

const engine = {} as Engine;

describe('growFloatToCover', () => {
  beforeEach(() => {
    const layer = { ...createRasterLayer({ name: 'L', width: 400, height: 300 }), id: 'grow-layer' };
    useEditorStore.setState((s) => ({
      document: { ...s.document, layers: [layer], activeLayerId: layer.id },
      dirtyLayerIds: new Set<string>(),
    }));
  });

  // #1018: growth runs on every pointer-move of a transform drag. A pixel
  // version bump per growth queued a synchronous thumbnail readback mid-drag.
  it('follows the grown texture without bumping the pixel version', () => {
    const before = pixelDataManager.versionOf('grow-layer');
    growFloatToCover(engine, 'grow-layer', { x: 10, y: 10, width: 580, height: 480 });

    const state = useEditorStore.getState();
    const layer = state.document.layers.find((l) => l.id === 'grow-layer');
    expect(layer).toMatchObject({ x: 0, y: 0, width: 600, height: 500 });
    expect(state.dirtyLayerIds.has('grow-layer')).toBe(true);
    expect(pixelDataManager.versionOf('grow-layer')).toBe(before);
  });
});
