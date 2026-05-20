import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useEditorStore } from './app/editor-store';
import { useUIStore } from './app/ui-store';
import { useToolSettingsStore } from './app/tool-settings-store';
import { usePatternStore } from './app/pattern-store';
import { useShortcutStore } from './app/store/shortcut-store';
import { pixelDataManager } from './engine/pixel-data-manager';
import { getEngine, getEngineCanvas } from './engine-wasm/engine-state';
import { render as renderWasm, readLayerPixels, getLayerTextureDimensions, initWasm, isFontLoaded } from './engine-wasm/wasm-bridge';
import {
  syncDocumentSize,
  syncBackgroundColor,
  syncViewport,
  syncLayers,
  syncSelection,
  syncGroupAdjustments,
} from './engine-wasm/engine-sync';
import { finalizePendingStrokeGlobal } from './app/interactions/pending-stroke';
import { saveProject } from './io/project-save';
import { loadProject } from './io/project-load';
import './styles/tokens.css';
import './styles/reset.css';

// Dev-only debug hooks exposed on `window` for e2e tests.
type ReadPixelsResult = { width: number; height: number; pixels: number[] } | null;

declare global {
  interface Window {
    __editorStore?: typeof useEditorStore;
    __uiStore?: typeof useUIStore;
    __toolSettingsStore?: typeof useToolSettingsStore;
    __brushPresetStore?: typeof useToolSettingsStore;
    __patternStore?: typeof usePatternStore;
    __shortcutStore?: typeof useShortcutStore;
    __pixelData?: typeof pixelDataManager;
    __readCompositedPixels?: () => Promise<ReadPixelsResult>;
    __readLayerPixels?: (layerId?: string) => Promise<ReadPixelsResult>;
    __isFontLoaded?: (family: string) => boolean;
    __saveProject?: () => Promise<void>;
    __loadProject?: (file: File) => Promise<void>;
  }
}

// Expose stores for e2e tests
if (import.meta.env.DEV) {
  window.__editorStore = useEditorStore;
  window.__uiStore = useUIStore;
  window.__toolSettingsStore = useToolSettingsStore;
  // Back-compat alias — e2e tests read presets via __brushPresetStore. The
  // merged tool-settings store has the same shape for preset access.
  window.__brushPresetStore = useToolSettingsStore;
  window.__patternStore = usePatternStore;
  window.__shortcutStore = useShortcutStore;
  // Pixel-data Maps used to live on the store; they live on the manager now.
  // E2e tests that read or mutate pixel state go through this singleton.
  window.__pixelData = pixelDataManager;
  // Read composited pixels from the WebGL canvas by triggering a render
  // inside requestAnimationFrame and reading before buffer swap.
  // Returns screen-sized pixels (includes workspace background).
  window.__readCompositedPixels = () => {
    return new Promise<ReadPixelsResult>((resolve) => {
      requestAnimationFrame(() => {
        const engine = getEngine();
        const canvas = getEngineCanvas();
        if (!engine || !canvas) { resolve(null); return; }
        const state = useEditorStore.getState();
        const doc = state.document;
        const bg = doc.backgroundColor;
        const container = canvas.parentElement;
        const screenW = container ? container.clientWidth : canvas.width;
        const screenH = container ? container.clientHeight : canvas.height;
        syncDocumentSize(engine, doc.width, doc.height);
        syncBackgroundColor(engine, bg.r, bg.g, bg.b, bg.a);
        syncViewport(engine, state.viewport.zoom, state.viewport.panX, state.viewport.panY, screenW, screenH);
        syncLayers(engine, doc.layers, doc.layerOrder, state.dirtyLayerIds);
        syncGroupAdjustments(engine, doc.layers);
        syncSelection(engine, state.selection);
        renderWasm(engine);
        const gl = canvas.getContext('webgl2');
        if (!gl) { resolve(null); return; }
        const w = canvas.width;
        const h = canvas.height;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        resolve({ width: w, height: h, pixels: Array.from(pixels) });
      });
    });
  };
  // Read a single layer's GPU texture as {width, height, pixels[]}.
  // Syncs layers first so newly created layers are known to the engine.
  window.__isFontLoaded = (family: string) => {
    const engine = getEngine();
    if (!engine) return false;
    return isFontLoaded(engine, family);
  };
  window.__saveProject = saveProject;
  window.__loadProject = loadProject;
  window.__readLayerPixels = (layerId?: string) => {
    return new Promise<ReadPixelsResult>((resolve) => {
      requestAnimationFrame(() => {
        const engine = getEngine();
        const canvas = getEngineCanvas();
        if (!engine || !canvas) { resolve(null); return; }
        // Bake any deferred stroke into the layer texture so the readback
        // reflects the user-visible state, not the pre-stroke layer.
        finalizePendingStrokeGlobal();
        const state = useEditorStore.getState();
        const doc = state.document;
        const container = canvas.parentElement;
        const screenW = container ? container.clientWidth : canvas.width;
        const screenH = container ? container.clientHeight : canvas.height;
        syncDocumentSize(engine, doc.width, doc.height);
        syncBackgroundColor(engine, doc.backgroundColor.r, doc.backgroundColor.g, doc.backgroundColor.b, doc.backgroundColor.a);
        syncViewport(engine, state.viewport.zoom, state.viewport.panX, state.viewport.panY, screenW, screenH);
        syncLayers(engine, doc.layers, doc.layerOrder, state.dirtyLayerIds);
        const id = layerId ?? doc.activeLayerId;
        if (!id) { resolve({ width: 0, height: 0, pixels: [] }); return; }
        const dims = getLayerTextureDimensions(engine, id);
        const w = dims?.[0] ?? 0;
        const h = dims?.[1] ?? 0;
        if (w === 0 || h === 0) { resolve({ width: 0, height: 0, pixels: [] }); return; }
        const pixels = readLayerPixels(engine, id);
        if (!pixels || pixels.length === 0) { resolve({ width: 0, height: 0, pixels: [] }); return; }
        resolve({ width: w, height: h, pixels: Array.from(pixels) });
      });
    });
  };
}

// Prevent browser zoom so Ctrl+wheel and pinch gestures only affect the canvas.
// Register at window + capture phase so nothing can stop propagation first.
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false, capture: true });
window.addEventListener('gesturestart', (e) => e.preventDefault(), { capture: true });
window.addEventListener('gesturechange', (e) => e.preventDefault(), { capture: true });
window.addEventListener('gestureend', (e) => e.preventDefault(), { capture: true });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
    e.preventDefault();
  }
}, { capture: true });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

initWasm().catch(() => {});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
