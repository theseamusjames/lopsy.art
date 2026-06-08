/**
 * DNG raw image import — decodes DNG files (including Apple ProRAW) via the
 * Rust-side decoder and uploads pixel data to the GPU.
 *
 * ## Pipeline (Rust side, see engine-rs/crates/lopsy-core/src/dng/)
 *
 * 1. Parse TIFF IFD structure, find the full-resolution SubIFD
 * 2. Decompress pixel data (lossless JPEG for ProRAW, also supports deflate)
 * 3. Normalize to [0, 1] using WhiteLevel (or measured data max as fallback —
 *    Apple ProRAW sets WhiteLevel=65535 even for 10-bit data) minus BlackLevel
 * 4. White balance (AsShotNeutral) and color matrix (ForwardMatrix, or the
 *    neutralized inverse ColorMatrix) → sRGB. Always applied: ProRAW carries
 *    camera-native linear data even when AsShotNeutral≈[1,1,1].
 * 5. BaselineExposure, then ProfileToneCurve (257 points, near-linear), then
 *    sRGB gamma. ProfileGainTableMap is disabled — it mis-applies and washes
 *    the image out; see the decoder's module docs.
 * 6. Auto black/white-point stretch from luminance percentiles, filling [0, 1]
 *    so the load isn't flat (Apple's near-linear tone curve assumes its own
 *    HDR pass adds the contrast).
 * 7. Apply the EXIF/TIFF Orientation tag so portrait shots load upright.
 * 8. Upload as f32 RGBA to RGBA16F GPU texture via upload_pixels_f32.
 *
 * The decoder produces a finished, correctly-ranged image on its own, so we do
 * NOT attach any default group adjustments on import — the document opens clean.
 *
 * ## Future improvements
 *
 * - ProfileHueSatMapData (tags 50937/50938): per-hue saturation and luminance
 *   adjustments. Not present in our test ProRAW files but used by some cameras.
 * - ProfileLookTable (tag 50981/50982): 3D color LUT for the profile "look".
 *   Would allow matching specific camera profiles more closely.
 * - Support for non-Apple DNG files from other cameras (tested with iPhone
 *   ProRAW only so far).
 */

import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadDng, initWasm } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { notifyError } from '../app/notifications-store';

interface DngMeta {
  width: number;
  height: number;
  baselineExposure: number;
  toneCurve: [number, number][];
}

export async function importDngFile(data: Uint8Array, name: string): Promise<void> {
  const ui = useUIStore.getState();
  ui.openModal({ kind: 'loading', message: 'Opening DNG…' });

  try {
    await importDngFileInner(data, name);
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

async function importDngFileInner(data: Uint8Array, name: string): Promise<void> {
  await initWasm();

  useEditorStore.getState().createDocument(1, 1, true);

  const engine = await waitForEngine();
  if (!engine) {
    notifyError('Engine not ready');
    return;
  }

  const activeLayerId = useEditorStore.getState().document.activeLayerId;
  if (!activeLayerId) {
    notifyError('No active layer');
    return;
  }

  // Yield two frames: the first lets the render loop sync the initial
  // document size (avoiding a recursive borrow in wasm_bindgen's RefCell),
  // the second ensures the browser actually paints the loading modal before
  // we block the main thread with the WASM decode. rAF callbacks run before
  // paint, so a single yield would commit the DOM but never paint it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const metaJson = decodeAndUploadDng(engine, activeLayerId, data);
  const meta: DngMeta = JSON.parse(metaJson);

  if (meta.width === 0 || meta.height === 0) {
    notifyError('DNG decode returned empty image');
    return;
  }

  useEditorStore.setState((s) => {
    const layers = s.document.layers.map((l) => {
      if (l.id === activeLayerId && l.type === 'raster') {
        return { ...l, width: meta.width, height: meta.height, name };
      }
      return l;
    });
    return {
      document: { ...s.document, width: meta.width, height: meta.height, layers, name },
    };
  });

  // The DNG decoder uploaded pixels directly to the GPU texture. Clear the
  // stale 1x1 placeholder from the JS pixel data store so that
  // resetTrackedState doesn't cause engine-sync to overwrite the GPU texture.
  pixelDataManager.remove(activeLayerId);

  resetTrackedState(engine);
  useEditorStore.getState().fitToView();
}

async function waitForEngine(maxFrames = 60): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const engine = getEngine();
    if (engine) return engine;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}
