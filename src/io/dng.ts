/**
 * DNG raw image import — decodes DNG files (including Apple ProRAW) via the
 * Rust-side decoder and uploads pixel data to the GPU.
 *
 * ## Pipeline (Rust side, see engine-rs/crates/lopsy-core/src/dng/)
 *
 * 1. Parse TIFF IFD structure, find the full-resolution SubIFD
 * 2. Decompress pixel data (lossless JPEG for ProRAW, also supports deflate)
 * 3. Normalize to [0, 1] using WhiteLevel (or measured data max as fallback —
 *    Apple ProRAW sets WhiteLevel=65535 even for 10-bit data)
 * 4. For standard CFA DNG: demosaic (bilinear) + white balance + color matrix
 *    For Linear DNG with AsShotNeutral≈[1,1,1] (Apple ProRAW): skip WB and
 *    color matrix — the ISP already applied them
 * 5. ProfileGainTableMap (DNG 1.6, tag 52525): per-pixel local tone mapping.
 *    36×46 spatial grid, 257-entry LUT per grid point. Gain is trilinearly
 *    interpolated across space and brightness. Shadows get ~2.8× boost,
 *    highlights stay at 1×. Data is big-endian regardless of TIFF byte order.
 * 6. BaselineExposure (typically tiny, ~0.07 EV for ProRAW)
 * 7. ProfileToneCurve (257 points, nearly linear for ProRAW)
 * 8. sRGB gamma encoding
 * 9. Upload as f32 RGBA to RGBA16F GPU texture via upload_pixels_f32
 *
 * ## What's missing vs Apple Preview / Camera Raw
 *
 * After applying everything the DNG standard provides (gain table map, tone
 * curve, baseline exposure), the result is still noticeably flat compared to
 * Apple Preview or Adobe Camera Raw. This is because:
 *
 * - Apple's ProRAW ProfileToneCurve is intentionally near-linear to preserve
 *   editing latitude. The "punch" comes from the rendering engine, not the file.
 * - Apple Preview likely applies proprietary rendering beyond DNG metadata.
 * - Camera Raw applies its own "Adobe Standard" profile with contrast/saturation.
 *
 * To compensate, we set default group adjustments (exposure, contrast, blacks,
 * levels, curves, vibrance) that approximate a camera-like rendering. These
 * are fully visible and editable in the Project group adjustments panel.
 *
 * ## Future improvements
 *
 * - ProfileHueSatMapData (tags 50937/50938): per-hue saturation and luminance
 *   adjustments. Not present in our test ProRAW files but used by some cameras.
 * - ProfileLookTable (tag 50981/50982): 3D color LUT for the profile "look".
 *   Would allow matching specific camera profiles more closely.
 * - Smarter default adjustments based on scene analysis (auto-exposure,
 *   auto-contrast from histogram).
 * - Move the gain table map processing to a Web Worker — it's the slowest
 *   step (~2-3 seconds for 24MP on the main thread).
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
import { DEFAULT_ADJUSTMENTS, type ImageAdjustments } from '../filters/image-adjustments';
import { IDENTITY_CURVES } from '../filters/curves';
import { IDENTITY_LEVELS, type Levels } from '../filters/levels';

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

  // Apply default adjustments to compensate for the flat rendering that the
  // DNG standard metadata alone produces. See module doc comment for why.
  const rootGroupId = useEditorStore.getState().document.rootGroupId;
  if (rootGroupId) {
    const store = useEditorStore.getState();
    store.setGroupAdjustments(rootGroupId, RAW_DEFAULT_ADJUSTMENTS);
    store.setGroupAdjustmentsEnabled(rootGroupId, true);
  }

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

// Default adjustments for raw import. These approximate the contrast and
// saturation that camera apps add on top of the flat DNG rendering.
// Tuned against Apple ProRAW from iPhone 16 Pro Max — may need refinement
// for other cameras. All values are editable in the Project group panel.
const RAW_DEFAULT_LEVELS: Levels = {
  ...IDENTITY_LEVELS,
  rgb: {
    inputBlack: 15 / 255,
    inputWhite: 200 / 255,
    gamma: 0.65,
    outputBlack: 0,
    outputWhite: 240 / 255,
  },
};

const RAW_DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  ...DEFAULT_ADJUSTMENTS,
  exposure: -0.5,
  contrast: 40,
  blacks: -25,
  vibrance: 15,
  curves: {
    ...IDENTITY_CURVES,
    rgb: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.18 },
      { x: 0.50, y: 0.50 },
      { x: 0.75, y: 0.85 },
      { x: 1, y: 1 },
    ],
  },
  levels: RAW_DEFAULT_LEVELS,
};
