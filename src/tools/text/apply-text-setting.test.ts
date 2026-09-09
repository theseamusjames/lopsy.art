import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track calls into the anchored/place bridge so we can verify #758's
// slider-drag path no longer re-renders the *old* layer once per event.
const hoisted = vi.hoisted(() => ({
  rerenderCommittedTextLayerAnchored: vi.fn(
    (_engine: unknown, _oldLayer: unknown, _newLayer: unknown) => ({ x: 100, y: 100, anchorX: 50, anchorY: 60 }),
  ),
  placeTextLayerAtAnchor: vi.fn((_engine: unknown, _layer: unknown, x: number, y: number) => ({ x, y })),
  invalidatePathTextCache: vi.fn(),
  invalidateEditingTextCache: vi.fn(),
  resetTextLayerLayout: vi.fn(),
}));
const {
  rerenderCommittedTextLayerAnchored,
  placeTextLayerAtAnchor,
} = hoisted;

vi.mock('../../engine-wasm/engine-sync', () => ({
  rerenderCommittedTextLayerAnchored: hoisted.rerenderCommittedTextLayerAnchored,
  placeTextLayerAtAnchor: hoisted.placeTextLayerAtAnchor,
  invalidatePathTextCache: hoisted.invalidatePathTextCache,
  invalidateEditingTextCache: hoisted.invalidateEditingTextCache,
  resetTextLayerLayout: hoisted.resetTextLayerLayout,
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

vi.mock('../../app/local-fonts-store', () => ({
  findFontEntry: () => null,
  loadLocalFontToEngine: () => Promise.resolve(false),
}));
vi.mock('../../utils/font-loader', () => ({
  extractFamilyName: (f: string) => f,
  loadGoogleFont: () => {},
  loadFontBinaryToEngine: () => Promise.resolve(false),
}));

// Zustand-shaped mocks. Values are mutable so tests can vary them.
const textLayer: Record<string, unknown> = {
  id: 'text-1',
  type: 'text' as const,
  x: 10,
  y: 20,
  fontSize: 100,
  fontFamily: 'Inter',
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.2,
  letterSpacing: 0,
  paragraphSpacing: 0,
  textAlign: 'left',
  color: { r: 0, g: 0, b: 0, a: 1 },
  text: 'HELLO',
  underline: false,
  strikethrough: false,
  vertical: false,
};

const editorStateHoisted = vi.hoisted(() => ({
  state: {
    document: {
      activeLayerId: 'text-1',
      layers: [] as Record<string, unknown>[],
    },
    pushHistory: vi.fn(),
    updateTextLayerProperties: vi.fn(),
    notifyRender: vi.fn(),
  },
}));
const editorState = editorStateHoisted.state;

vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorStateHoisted.state },
}));

const uiStateHoisted = vi.hoisted(() => ({
  state: {
    textEditing: null as null | { layerId: string },
  },
}));
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiStateHoisted.state },
}));

const toolSettingsHoisted = vi.hoisted(() => ({
  state: {
    settings: {
      text: {
        fontSize: 100 as unknown,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        align: 'left',
        underline: false,
        strikethrough: false,
        lineHeight: 1.2,
        letterSpacing: 0,
        paragraphSpacing: 0,
        vertical: false,
      } as Record<string, unknown>,
    },
    setTextSetting: vi.fn(),
    addRecentColor: vi.fn(),
    addRecentFont: vi.fn(),
  },
}));
toolSettingsHoisted.state.setTextSetting.mockImplementation((key: string, v: unknown) => {
  toolSettingsHoisted.state.settings.text[key] = v;
});
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => toolSettingsHoisted.state },
}));

// Import after mocks are set up.
import {
  applyTextSetting,
  beginTextLayerHistory,
  endTextLayerHistory,
} from './apply-text-setting';

// Force the coalescer to run rAFs synchronously so we can assert counts.
beforeEach(() => {
  rerenderCommittedTextLayerAnchored.mockClear();
  placeTextLayerAtAnchor.mockClear();
  editorState.updateTextLayerProperties.mockClear();
  editorState.pushHistory.mockClear();
  editorState.document.layers = [textLayer];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Reset the module-level dragAnchor between tests.
  endTextLayerHistory();
});

describe('apply-text-setting drag anchor caching (#758)', () => {
  it('beginTextLayerHistory rasterizes the old layer exactly once to derive the anchor', () => {
    beginTextLayerHistory();
    expect(editorState.pushHistory).toHaveBeenCalledTimes(1);
    // One measurement to recover the anchor.
    expect(rerenderCommittedTextLayerAnchored).toHaveBeenCalledTimes(1);
  });

  it('drag stream uses the cached anchor: 20 pointer-moves = 0 additional old-layer measurements', () => {
    beginTextLayerHistory();
    rerenderCommittedTextLayerAnchored.mockClear();

    for (let i = 0; i < 20; i++) {
      applyTextSetting('fontSize', 100 + i);
    }

    // rerenderCommittedTextLayerAnchored performs the discarded "measure old"
    // rasterization. With the drag anchor cached at begin*, it must not be
    // called again during the drag.
    expect(rerenderCommittedTextLayerAnchored).not.toHaveBeenCalled();
    // The coalesced re-render (via placeTextLayerAtAnchor) runs at most once
    // per rAF; with our synchronous stub, each applyTextSetting flushes.
    expect(placeTextLayerAtAnchor).toHaveBeenCalled();
  });

  it('endTextLayerHistory clears the cache so the next edit re-derives the anchor', () => {
    beginTextLayerHistory();
    endTextLayerHistory();
    rerenderCommittedTextLayerAnchored.mockClear();

    applyTextSetting('fontSize', 200);

    // No cached anchor → fell through to the anchored re-render slow path.
    expect(rerenderCommittedTextLayerAnchored).toHaveBeenCalledTimes(1);
  });

  it('applyTextSetting outside a drag takes the slow path once', () => {
    rerenderCommittedTextLayerAnchored.mockClear();
    applyTextSetting('fontSize', 150);
    expect(rerenderCommittedTextLayerAnchored).toHaveBeenCalledTimes(1);
  });

  it('updateTextLayerProperties fires on every applyTextSetting even in a drag (store stays live)', () => {
    beginTextLayerHistory();
    editorState.updateTextLayerProperties.mockClear();

    applyTextSetting('fontSize', 110);
    applyTextSetting('fontSize', 120);
    applyTextSetting('fontSize', 130);

    // The store update is synchronous per event (React reflects the value
    // in the slider chip immediately). Each applyTextSetting calls
    // updateTextLayerProperties once directly plus, in this synchronous-rAF
    // test harness, once via the coalesced render's own position update.
    expect(editorState.updateTextLayerProperties).toHaveBeenCalled();
    // Direct calls (the {[layerKey]: clamped} write) happen once per event.
    const propKeys = editorState.updateTextLayerProperties.mock.calls.map((c) => Object.keys(c[1] as object).join(','));
    const fontSizeUpdates = propKeys.filter((k) => k === 'fontSize').length;
    expect(fontSizeUpdates).toBe(3);
  });
});
