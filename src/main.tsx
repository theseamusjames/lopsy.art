import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useEditorStore } from './app/editor-store';
import { useUIStore } from './app/ui-store';
import { useToolSettingsStore } from './app/tool-settings-store';
import { usePatternStore } from './app/pattern-store';
import { useShortcutStore } from './app/store/shortcut-store';
import { useDockStore } from './panels/dock/dock-store';
import { pixelDataManager } from './engine/pixel-data-manager';
import { getEngine, getEngineCanvas, isWgpuRenderer, engineStarted } from './engine-wasm/engine-state';
import { render as renderWasm, markAllDirty, readLayerPixels, getLayerTextureDimensions, initWasm, isFontLoaded, liveGpuSnapshotCount, effectCacheStats } from './engine-wasm/wasm-bridge';
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
import { importRafFile } from './io/raf';
import { compositeForExport, getCompositeSize, parkedReadbackCount } from './engine-wasm/wasm-bridge';
import { flushLayerSync, textFrameOffsetMeasureCount } from './engine-wasm/engine-sync';
import { prefetchFontPreviewsBlob } from './utils/font-loader';
import { canvasPixelRatio } from './app/rendering/display-pixel-ratio';
import { layerBackupStats, setLayerBackupMaxBytesForTest } from './app/gpu-layer-backup';
import type { LayerBackupStats } from './app/layer-backup-runner';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/reset.css';

// Dev-only debug hooks exposed on `window` for e2e tests.
type ReadPixelsResult = { width: number; height: number; pixels: number[] } | null;
interface EffectCacheStats {
  entries: number;
  images: number;
  bytes: number;
  budgetBytes: number;
  hits: number;
  misses: number;
}

declare global {
  interface Window {
    __editorStore?: typeof useEditorStore;
    __uiStore?: typeof useUIStore;
    __toolSettingsStore?: typeof useToolSettingsStore;
    __brushPresetStore?: typeof useToolSettingsStore;
    __patternStore?: typeof usePatternStore;
    __shortcutStore?: typeof useShortcutStore;
    __dockStore?: typeof useDockStore;
    __pixelData?: typeof pixelDataManager;
    __readCompositedPixels?: () => Promise<ReadPixelsResult>;
    __parkedReadbacks?: () => number;
    __engineStarted?: () => Promise<unknown>;
    __readLayerPixels?: (layerId?: string) => Promise<ReadPixelsResult>;
    __gpuSnapshotCount?: () => number;
    __effectCacheStats?: () => EffectCacheStats | null;
    __layerBackupStats?: () => LayerBackupStats;
    __setLayerBackupMaxBytes?: (bytes: number | null) => void;
    __textFrameOffsetMeasureCount?: () => number;
    __isFontLoaded?: (family: string) => boolean;
    __saveProject?: () => Promise<void>;
    __loadProject?: (file: File) => Promise<void>;
    __importRafFile?: (data: Uint8Array, name: string) => Promise<void>;
    __exportDocAsJpg?: (longEdge: number, quality: number) => Promise<{ width: number; height: number; b64: string } | null>;
  }
}

/**
 * What a WebGPU canvas shows, in the shape WebGL's `readPixels` gives: bottom
 * row first and premultiplied. A WebGPU canvas has no `readPixels`, but
 * until the task that drew it ends it can be drawn into a 2D canvas, which
 * hands back straight alpha, top row first.
 */
function readPresentedCanvas(canvas: HTMLCanvasElement): ReadPixelsResult {
  const { width, height } = canvas;
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0);
  const straight = ctx.getImageData(0, 0, width, height).data;
  const pixels = new Array<number>(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width * 4;
    const to = y * width * 4;
    for (let i = 0; i < width * 4; i += 4) {
      const alpha = straight[from + i + 3] ?? 0;
      pixels[to + i] = Math.round(((straight[from + i] ?? 0) * alpha) / 255);
      pixels[to + i + 1] = Math.round(((straight[from + i + 1] ?? 0) * alpha) / 255);
      pixels[to + i + 2] = Math.round(((straight[from + i + 2] ?? 0) * alpha) / 255);
      pixels[to + i + 3] = alpha;
    }
  }
  return { width, height, pixels };
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
  window.__dockStore = useDockStore;
  // Pixel-data Maps used to live on the store; they live on the manager now.
  // E2e tests that read or mutate pixel state go through this singleton.
  window.__pixelData = pixelDataManager;
  window.__parkedReadbacks = parkedReadbackCount;
  window.__engineStarted = engineStarted;
  // Read composited pixels from the WebGL canvas by triggering a render
  // inside requestAnimationFrame and reading before buffer swap.
  // Returns screen-sized pixels (includes workspace background).
  window.__readCompositedPixels = async () => {
    await engineStarted();
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
        syncViewport(engine, state.viewport.zoom, state.viewport.panX, state.viewport.panY, screenW, screenH, canvasPixelRatio(canvas, screenW));
        syncLayers(engine, doc.layers, doc.layerOrder, state.dirtyLayerIds, doc.colorMode);
        syncGroupAdjustments(engine, doc.layers);
        syncSelection(engine, state.selection);
        // render() skips clean frames; force a recomposite so readPixels
        // sees fresh drawing-buffer content in this same task.
        markAllDirty(engine);
        renderWasm(engine);
        if (isWgpuRenderer()) { resolve(readPresentedCanvas(canvas)); return; }
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
  window.__importRafFile = importRafFile;
  window.__exportDocAsJpg = async (longEdge: number, quality: number) => {
    const engine = getEngine();
    if (!engine) return null;
    flushLayerSync(useEditorStore.getState());
    const sizeArr = getCompositeSize(engine);
    const w = sizeArr[0] ?? 0;
    const h = sizeArr[1] ?? 0;
    if (!w || !h) return null;
    const rawPixels = await compositeForExport(engine);
    const scale = longEdge / Math.max(w, h);
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d');
    if (!sctx) return null;
    // Use createImageData() so the pixel-debt linter stays happy — it
    // gives back a writable .data buffer that we fill with .set(),
    // avoiding the banned allocation patterns.
    const imgData = sctx.createImageData(w, h);
    imgData.data.set(rawPixels);
    sctx.putImageData(imgData, 0, 0);
    const dst = document.createElement('canvas');
    dst.width = dw;
    dst.height = dh;
    const dctx = dst.getContext('2d');
    if (!dctx) return null;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(src, 0, 0, dw, dh);
    const blob: Blob | null = await new Promise((r) => dst.toBlob((b) => r(b), 'image/jpeg', quality));
    if (!blob) return null;
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return { width: dw, height: dh, b64: btoa(bin) };
  };
  window.__gpuSnapshotCount = () => {
    const engine = getEngine();
    return engine ? liveGpuSnapshotCount(engine) : 0;
  };
  window.__layerBackupStats = layerBackupStats;
  window.__setLayerBackupMaxBytes = setLayerBackupMaxBytesForTest;
  window.__effectCacheStats = () => {
    const engine = getEngine();
    if (!engine) return null;
    const [entries = 0, images = 0, bytes = 0, budgetBytes = 0, hits = 0, misses = 0] = effectCacheStats(engine);
    return { entries, images, bytes, budgetBytes, hits, misses };
  };
  window.__textFrameOffsetMeasureCount = textFrameOffsetMeasureCount;
  window.__readLayerPixels = async (layerId?: string) => {
    await engineStarted();
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
        syncViewport(engine, state.viewport.zoom, state.viewport.panX, state.viewport.panY, screenW, screenH, canvasPixelRatio(canvas, screenW));
        syncLayers(engine, doc.layers, doc.layerOrder, state.dirtyLayerIds, doc.colorMode);
        const id = layerId ?? doc.activeLayerId;
        if (!id) { resolve({ width: 0, height: 0, pixels: [] }); return; }
        if ((getLayerTextureDimensions(engine, id)?.[0] ?? 0) === 0) { resolve({ width: 0, height: 0, pixels: [] }); return; }
        readLayerPixels(engine, id).then(
          (pixels) => {
            if (!pixels || pixels.length === 0) { resolve({ width: 0, height: 0, pixels: [] }); return; }
            // The size as it is now: on wgpu the read waits its turn, and a
            // crop ahead of it may have resized the texture since it was
            // asked. If the texture changed again while the read was out,
            // read again.
            const dims = getLayerTextureDimensions(engine, id);
            const w = dims?.[0] ?? 0;
            const h = dims?.[1] ?? 0;
            if (pixels.length !== w * h * 4) { resolve(window.__readLayerPixels?.(layerId) ?? null); return; }
            resolve({ width: w, height: h, pixels: Array.from(pixels) });
          },
          () => resolve(null),
        );
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

// Kick off the font-preview blob download after the app is interactive so the
// FontPicker's first open finds it ready.
const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  ?? ((cb: () => void) => setTimeout(cb, 0));
idle(() => prefetchFontPreviewsBlob());

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
