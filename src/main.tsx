import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useEditorStore } from './app/editor-store';
import { useUIStore } from './app/ui-store';
import { useToolSettingsStore } from './app/tool-settings-store';
import { useBrushPresetStore } from './app/brush-preset-store';
import { getEngine, getEngineCanvas } from './engine-wasm/engine-state';
import { render as renderWasm, readLayerPixels, getLayerTextureDimensions } from './engine-wasm/wasm-bridge';
import {
  syncDocumentSize,
  syncBackgroundColor,
  syncViewport,
  syncLayers,
  syncSelection,
} from './engine-wasm/engine-sync';
import './styles/tokens.css';
import './styles/reset.css';

// Expose stores for e2e tests
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__editorStore = useEditorStore;
  (window as unknown as Record<string, unknown>).__uiStore = useUIStore;
  (window as unknown as Record<string, unknown>).__toolSettingsStore = useToolSettingsStore;
  (window as unknown as Record<string, unknown>).__brushPresetStore = useBrushPresetStore;
  // Read composited pixels from the WebGL canvas by triggering a render
  // inside requestAnimationFrame and reading before buffer swap.
  // Returns screen-sized pixels (includes workspace background).
  (window as unknown as Record<string, unknown>).__readCompositedPixels = () => {
    return new Promise<{ width: number; height: number; pixels: number[] } | null>((resolve) => {
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
        syncLayers(engine, doc.layers, doc.layerOrder, state.layerPixelData, state.sparseLayerData, state.dirtyLayerIds);
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
  (window as unknown as Record<string, unknown>).__readLayerPixels = (layerId?: string) => {
    return new Promise<{ width: number; height: number; pixels: number[] } | null>((resolve) => {
      requestAnimationFrame(() => {
        const engine = getEngine();
        const canvas = getEngineCanvas();
        if (!engine || !canvas) { resolve(null); return; }
        const state = useEditorStore.getState();
        const doc = state.document;
        const container = canvas.parentElement;
        const screenW = container ? container.clientWidth : canvas.width;
        const screenH = container ? container.clientHeight : canvas.height;
        syncDocumentSize(engine, doc.width, doc.height);
        syncBackgroundColor(engine, doc.backgroundColor.r, doc.backgroundColor.g, doc.backgroundColor.b, doc.backgroundColor.a);
        syncViewport(engine, state.viewport.zoom, state.viewport.panX, state.viewport.panY, screenW, screenH);
        syncLayers(engine, doc.layers, doc.layerOrder, state.layerPixelData, state.sparseLayerData, state.dirtyLayerIds);
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

// Prevent browser zoom so Ctrl+wheel and pinch gestures only affect the canvas
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
