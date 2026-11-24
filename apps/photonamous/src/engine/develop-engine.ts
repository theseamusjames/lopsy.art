/**
 * The engine bridge for one photo: the Edit view's canvas, one image
 * layer, and the recipe mapped onto the engine (the RAW develop stage,
 * tone, colour and curves through develop-stages.ts, detail, areas, and
 * the framing as layer operations and document size). It calls the wasm
 * exports directly, without Lopsy's stores or engine-sync.
 *
 * The Edit view edits a working image sized to the view (spec 6.10) and
 * loads the full size on demand; exports load the full size.
 *
 * Pixels never come into TypeScript. Decoded images go straight to the
 * layer texture (RAF bands from the worker pool, DNG and 16-bit PNG through
 * the engine's decoders, other formats from a canvas the browser decoded
 * into). Previews and exports are drawn by the engine into its own canvas at
 * the output size and handed to `OffscreenCanvas.convertToBlob`; full-size
 * PNG uses the engine's 16-bit encoder.
 *
 * Colour: where the GPU renders to float targets every photo is edited in
 * the engine's linear Rec. 2020 working space (`setDevelopWorkingSpace`),
 * and the engine's output step renders it for its target: the canvas's
 * space for the screen (Display P3 where the display has it, else sRGB),
 * and each file's own space for an export. A draw that is copied out of the
 * canvas (previews, 8-bit exports) first sets the canvas to the space of
 * the file it makes, so a copy is never converted by the browser and a
 * stored preview is sRGB whatever the display. Without float targets the
 * working space stays off and the canvas stays sRGB: the engine's baked
 * RAW look in 8 bits, which the status bar calls "8-bit".
 */

import initWasm, {
  addLayer,
  setClippingWarning as engineSetClippingWarning,
  setImageDetailMaskView,
  setImageFinish,
  clearImageFinish,
  autoTone as engineAutoTone,
  autoToneScene,
  clearDevelopCurves,
  setDevelopAreaCurves,
  setDevelopAreaLook,
  setDevelopCurves,
  setDevelopLook,
  setDevelopTone,
  clearImageAreaLayer,
  clearImageAreas,
  setImageAreaColorGrading,
  setImageAreaColorMixer,
  setImageAreaCurvesLut,
  setImageAreaDetail,
  setImageAreaFinish,
  setImageAreaLocalContrast,
  setImageAreaOverlay,
  setImageAreaTone,
  setImageAreas,
  clearImageDetail,
  clearImageLocalContrast,
  setImageDetail,
  setImageLocalContrast,
  beginLayerTransform,
  compositeLayerTransformAffine,
  dropFloat,
  duplicateLayerTexture,
  getLayerEngineBounds,
  loseGpuDevice,
  prepareLayerTransformTarget,
  clearImageColorGrading,
  clearImageColorMixer,
  clearImageCurves,
  clearRawDevelop,
  decodeAndUploadDng,
  decodeAndUploadImage,
  flipLayer,
  removeLayer,
  render,
  rotateLayer90,
  setBackgroundColor,
  setDevelopWorkingSpace,
  setScreenOutput,
  setDevelopHdr,
  screenIsHdr,
  encodePqPng,
  computeGainMap,
  assembleGainMapJpeg,
  hdrHistogramWhiteBin,
  buildIccProfile,
  rafWhiteBalanceKelvin,
  rafWhiteBalancePresets,
  setDocumentSize,
  setImageBlacks,
  setImageColorGrading,
  setImageColorMixer,
  setImageContrast,
  setImageCurvesLut,
  setImageExposure,
  setImageHighlights,
  setImagePhotoFilter,
  setImageSaturation,
  setImageShadows,
  setImageVibrance,
  setImageWhites,
  setLayerOrder,
  setRawDevelop,
  setViewport,
  updateLayer,
  uploadLayerPixelsF32Rect,
  uploadLayerPixelsCompressedU16,
  uploadLayerPixelsFromCanvas,
  type Engine,
} from '@lopsy/engine-pkg/lopsy_wasm';
import {
  compositeForExport,
  createEngine,
  exportPng16,
  exportTiff16,
  readDevelopHistogram,
  readHdrHistogram,
  readHdrOutputF32,
  readSceneStatistics,
  rendererName,
  sampleColor,
  sampleNeutralWhiteBalance,
} from './wasm';
import { fallBackToWebgl, markWgpuFailed, type Renderer } from './renderer-choice';
import { currentStatus, noteEngineStarted, noteScreenHdr, onStatusChange } from './engine-status';
import type { DisplayInfo } from '@lopsy/engine-wasm/display';
import { withJpegIccProfile, withPngColorTag } from '@lopsy/image-metadata';
import { insertJpegExif } from '@lopsy/photos-core/export/exif-writer';
import { wasmUrlFor } from './engine-files';
import { keepForOffline } from '../sw/register';
import { webGpuTextureLimit } from '@lopsy/engine-wasm/renderer-choice';
import type { ImageFormat } from '@lopsy/photos-core/library/types';
import { DEFAULT_RECIPE, liveAreas, type Recipe } from '@lopsy/photos-core/library/recipe';
import { parseKelvinScale, parsePresets, type KelvinScale, type WhiteBalancePresetValues } from './white-balance';
import {
  framedSize,
  effectiveFraming,
  framingAngle,
  framingOps,
  sameAdjustments,
  type EngineAdjustments,
  type Framing,
} from './recipe-to-adjustments';
import { cropPixels, inverseRotation, isFullCrop, rotatedBounds, straightenedCrop, toFramed } from './crop';
import { detailKey, detailValues, localContrastValues } from './detail-controls';
import { finishKey, finishValues } from './finish-controls';
import { renderCounts, type RenderKind } from './render-counts';
import { areaLayerKey, areaLayerValues, areaValues, linearAreaLayerKey, linearAreaLayerValues, type AreaFrame } from './areas';
import { developPathFor, developStages, type DevelopPath, type LegacyStages, type LinearStages } from './develop-stages';
import { NO_INSETS, clampZoom, fitView, limitSize, panBy, zoomAround, type Insets, type Size, type View } from './viewport';
import { decodeRafInWorkers, DecodeAbortedError } from './raf/raf-decode';
import { parseRawDevelopSettings, rawSettingsFor, rawSettingsJson, temperatureTintFor, type RawDevelopSettings } from './raw-develop';
import { parseDevelopProfiles, profilesFor, type DevelopProfile } from './profiles';

export { DecodeAbortedError };

declare global {
  interface Window {
    /** Development builds: the build the last engine started on, and a way to lose its GPU, for e2e tests. */
    __photonamousEngine?: { rendererName: () => Renderer; loseDevice: () => boolean };
  }
}

export interface LoadProgress {
  /** 'refining': a first view is on screen while the full-size image is decoded. */
  readonly stage: 'reading' | 'decoding' | 'uploading' | 'refining';
  /** 0..1 when known. */
  readonly fraction: number | null;
}

export interface LoadOptions {
  /**
   * 'working' (the default): an image sized to the view, at most 4096 px,
   * as the Edit view edits (spec 6.10); the full size comes on demand.
   * 'full': the full-size image straight away, as exports want.
   */
  readonly resolution?: 'working' | 'full';
}

export interface ExportOptions {
  /**
   * 'tiff' is the engine's 16-bit TIFF, always full size. 'hdr-png' (BT.2100
   * PQ, Rec. 2020) and 'hdr-jpeg' (sRGB with a gain map) are HDR files,
   * also always full size: the engine reads the HDR picture at the
   * document's own size. Both need the working space.
   */
  readonly format: 'jpeg' | 'png' | 'tiff' | 'hdr-png' | 'hdr-jpeg';
  /** JPEG quality, 0..1. */
  readonly quality?: number;
  /** Limit on the long edge, in pixels. Full size when omitted. Ignored for TIFF. */
  readonly maxSize?: number;
  /** sRGB when omitted. Rec. 2020 for the 16-bit files only (TIFF, 16-bit PNG). */
  readonly colorSpace?: ExportColorSpace;
  /**
   * The edit to render, when it is not the one on screen. It is applied
   * once the full size has loaded, right before the draw, and the screen's
   * edit is put back afterwards.
   */
  readonly recipe?: Recipe;
  /** The exact output size (may enlarge); overrides `maxSize`. Ignored for TIFF. */
  readonly size?: Size;
  /** PNG only: 16 bits (the engine's PNG, full size only) by default, or 8. */
  readonly pngDepth?: 8 | 16;
  /**
   * 'hdr-jpeg' only: the EXIF block (photos-core `buildExportExif`) for the
   * base picture, put in before the gain map is joined so the file's MPF
   * index counts it. Null or absent: none.
   */
  readonly exif?: Uint8Array | null;
}

/** What the loaded photo offers the Edit view. */
export interface PhotoInfo {
  /** Developed by the engine's RAW stage: white balance in camera space, profiles. */
  readonly isRaw: boolean;
  /** Auto white balance's answer, as slider values; null when there is none (not RAW). */
  readonly autoWhiteBalance: { readonly temperature: number; readonly tint: number } | null;
  /** The Profile menu. */
  readonly profiles: readonly DevelopProfile[];
  /** The camera's white balance presets (RAW), in menu order; empty otherwise. */
  readonly whiteBalancePresets: readonly WhiteBalancePresetValues[];
  /** How the relative Temperature reads in Kelvin (RAW); null otherwise. */
  readonly kelvin: KelvinScale | null;
}

export type ToneValues = Recipe['tone'];

/** The spaces a file can be in. The engine renders each straight from the working space and tags the file. */
export type ExportColorSpace = 'srgb' | 'display-p3' | 'rec2020';

/** What a canvas can hold. */
type CanvasSpace = 'srgb' | 'display-p3';

export interface DevelopEngine {
  photoInfo(): PhotoInfo;
  /** 4 × 256 bins (R, G, B, luminance) of the displayed render; null when the engine cannot read one now. */
  readHistogram(): Promise<Uint32Array | null>;
  /**
   * 4 × 256 bins of the HDR rendering at `HDR_PEAK` (bin 255 at the peak),
   * for the histogram while the HDR view is on; null without the working
   * space or when the engine cannot read one now. Auto tone and every other
   * statistic keep `readHistogram`.
   */
  readHdrHistogram(): Promise<Uint32Array | null>;
  /** Where SDR white sits on `readHdrHistogram`'s axis, in bins (about 139.7 at a peak of 4). */
  hdrWhiteBin(): number;
  /** The rendered colour at a document pixel, 0..255, with the screen-only views off; null outside the image or when the engine cannot read it. */
  sampleAt(x: number, y: number): Promise<readonly [number, number, number] | null>;
  /** Auto tone for `recipe`: renders it, reads its histogram and returns the tone values the engine suggests. */
  autoTone(recipe: Recipe): Promise<ToneValues>;
  /** Decodes `source` into the engine, replacing any image already loaded. Resolves with its oriented size. */
  load(source: Blob, format: ImageFormat, onProgress?: (progress: LoadProgress) => void, options?: LoadOptions): Promise<Size>;
  /** The working image's width over the full image's: 1 at full resolution. */
  workingScale(): number;
  isFullResolution(): boolean;
  /** Replaces the working image with the full-size one (zoom to 50 % or closer, full-size export). */
  ensureFullResolution(): Promise<void>;
  isLoadingFullResolution(): boolean;
  /** Renders `recipe` from the next frame on. Cheap when nothing changed. */
  setRecipe(recipe: Recipe): void;
  /** The size the image is shown and exported at: framed, then cropped. Null before a load. */
  imageSize(): Size | null;
  /** The framed image before the crop. */
  fullImageSize(): Size | null;
  /** `imageSize()` at full resolution: what a full-size export makes, whatever the working size. Null before a load. */
  fullResolutionSize(): Size | null;
  /**
   * While the crop is being edited the whole framed image shows (the Edit
   * view draws the crop over it); otherwise the document is the crop.
   */
  setCropEditing(isEditing: boolean): void;
  /**
   * While a slider drags, the costly sharpening, noise reduction and local
   * contrast passes are left out (spec 6.10, "while dragging"), and come
   * back when it settles.
   */
  setInteractive(isInteractive: boolean): void;
  /** How the document sits on the source image, for Areas' handles; null before a load. */
  areaFrame(): AreaFrame | null;
  /** Shows an area's mask in red on screen (never in exports, previews or the histogram); null for none. */
  setAreaOverlay(areaId: string | null): void;
  getView(): View;
  /** Called after every view change (zoom, pan, fit, resize). */
  onViewChange(listener: (view: View) => void): () => void;
  fit(): void;
  /** Room a fit leaves clear at the canvas's edges, besides its padding (Crop's options); a fitted view refits. */
  setFitInsets(insets: Insets): void;
  /** `anchor` is in CSS pixels from the canvas's top-left. */
  setZoom(zoom: number, anchor?: { x: number; y: number }): void;
  /** CSS pixels. */
  panBy(dx: number, dy: number): void;
  /** A JPEG of the current edit, long edge at most `maxSize`. */
  renderPreview(maxSize: number, quality?: number, recipe?: Recipe): Promise<Blob>;
  /** JPEGs at each long edge in `maxSizes`, drawn in one go (one render each, one to put the view back). */
  renderPreviews(maxSizes: readonly number[], quality?: number, recipe?: Recipe): Promise<Blob[]>;
  exportImage(options: ExportOptions): Promise<Blob>;
  /** Whether this engine can write HDR files: it edits in the working space (not the 8-bit fallback). */
  canExportHdr(): boolean;
  /** Paints clipped pixels on the live frame only (any channel at or past white red, at or below black blue); exports are unaffected. */
  setClippingWarning(shadows: boolean, highlights: boolean): void;
  /** The photo's grain seed (finish-controls.ts grainSeed), so grain is the same on every render and export. */
  setGrainSeed(seed: number): void;
  /** Shows what Sharpen affects instead of the photo, on the live frame (Alt while dragging a Sharpen slider). */
  setDetailMaskView(on: boolean): void;
  /**
   * The white balance (recipe units: absolute for RAW, relative for other
   * photos) that makes the patch of `radius` document pixels around (x, y)
   * neutral; null before a load. A patch with a channel at zero reads
   * [0, 0].
   */
  sampleWhiteBalance(x: number, y: number, radius: number): Promise<{ temperature: number; tint: number } | null>;
  /** Which build draws: 'wgpu' (WebGPU) or 'webgl'. */
  rendererName(): Renderer;
  /**
   * Whether the GPU objects are gone: a lost WebGL context or WebGPU
   * device. A lost engine draws nothing again; dispose it and make another.
   */
  isLost(): boolean;
  /** Called once, when the GPU objects are lost. */
  onLost(listener: () => void): () => void;
  dispose(): void;
}

/**
 * The window event the wgpu engine raises when its device is lost
 * (engine/hosts/wasm/src/lib.rs). It does not say which engine's: every
 * wgpu engine in the page takes it as its own. A WebGL canvas fires
 * `webglcontextlost` itself.
 */
export const GPU_LOST_EVENT = 'lopsy-gpu-lost';

/**
 * The MIME type of a Lopsy layer handed over to be graded: the engine's
 * 16-bit layer blob (`readLayerPixelsLz4U16`), uploaded as it is. It loads
 * through the non-RAW pipeline with a transparent background, so the
 * layer's transparency survives the grade.
 */
export const LOPSY_LAYER_MIME = 'application/x-lopsy-layer16';

/** Largest Lopsy layer the engine loads, at 8 bytes a pixel (the handoff's own limit too). */
const MAX_LOPSY_LAYER_BYTES = 1024 * 1024 * 1024;

/** Long edge of the binned first view of a RAF (`rafRenderBinnedLinear`). */
const QUICK_VIEW_LONG_EDGE = 2048;
/** The working image's long edge: at least a screen preview's, at most spec 6.10's cap. */
const MIN_WORKING_EDGE = 2048;
const MAX_WORKING_EDGE = 4096;
/** Full resolution loads once the view shows the image at half its full size or closer. */
const FULL_RESOLUTION_ZOOM = 0.5;
const JPEG_MIME = 'image/jpeg';
const PNG_MIME = 'image/png';
/** The engine's colour space codes (exportPng16, buildIccProfile, setDevelopWorkingSpace's source). */
const SRGB = 0;
const DISPLAY_P3 = 1;
const REC2020 = 2;

function spaceCode(space: ExportColorSpace | undefined): number {
  if (space === 'display-p3') return DISPLAY_P3;
  if (space === 'rec2020') return REC2020;
  return SRGB;
}

/**
 * A browser-encoded PNG or JPEG with the profile of the space its pixels
 * are in, when the encoder left it untagged (Chromium tags a Display P3
 * canvas's files itself, not an sRGB one's). An sRGB PNG gets the sRGB
 * chunk alone, as the engine's own sRGB PNG does.
 */
async function tagColor(blob: Blob, code: number): Promise<Blob> {
  if (blob.type !== PNG_MIME && blob.type !== JPEG_MIME) return blob;
  const data = new Uint8Array(await blob.arrayBuffer());
  const icc = { name: code === DISPLAY_P3 ? 'Display P3' : 'sRGB', data: buildIccProfile(code) };
  const tagged = blob.type === PNG_MIME ? withPngColorTag(data, code === SRGB ? undefined : icc) : withJpegIccProfile(data, icc);
  return tagged === data ? blob : new Blob([tagged as BlobPart], { type: blob.type });
}
/**
 * The gain map's grey PNG (from the engine) as a JPEG, encoded by the
 * browser: decoded, drawn on a canvas of its own size and encoded at
 * `quality`, the same quality as the base picture.
 */
async function encodeGreyJpeg(png: Uint8Array, size: Size, quality: number): Promise<Uint8Array> {
  // The map's values are gains, not colours: nothing may convert them.
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: PNG_MIME }), { colorSpaceConversion: 'none' });
  try {
    const out = new OffscreenCanvas(size.width, size.height);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('the browser could not make a canvas to encode the gain map with');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await out.convertToBlob({ type: JPEG_MIME, quality });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

const TIFF_MIME = 'image/tiff';
/**
 * The HDR peak, a linear multiple of SDR white: two stops (plan decision 8).
 * The live HDR view, its histogram and HDR files all use it, so what the
 * screen shows above white is what the file holds.
 */
export const HDR_PEAK = 4;
/** The luminance SDR white is given in a PQ file, in cd/m² (ITU-R BT.2408). */
const PQ_SDR_WHITE_NITS = 203;
/** The gain map is half the picture's width and height (plan decision 14). */
const GAIN_MAP_SCALE = 2;
/** WebGPU's guaranteed largest texture side, when the adapter's is not known. */
const WEBGPU_DEFAULT_TEXTURE_LIMIT = 8192;

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = initWasm().then(
      (output) => {
        keepForOffline(wasmUrlFor(rendererName()));
        return output;
      },
      (err: unknown) => {
        wasmReady = null;
        throw err;
      },
    );
  }
  return wasmReady;
}

function layerDesc(id: string, width: number, height: number, isVisible: boolean, x = 0, y = 0): string {
  return JSON.stringify({
    id,
    name: 'Photo',
    layer_type: 'Raster',
    visible: isVisible,
    locked: false,
    opacity: 1,
    blend_mode: 'Normal',
    x,
    y,
    width,
    height,
    clip_to_below: false,
    effects: {},
    mask: null,
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function pushAdjustments(engine: Engine, adj: EngineAdjustments): void {
  setImageExposure(engine, adj.exposure);
  setImageContrast(engine, adj.contrast);
  setImageHighlights(engine, adj.highlights);
  setImageShadows(engine, adj.shadows);
  setImageWhites(engine, adj.whites);
  setImageBlacks(engine, adj.blacks);
  setImageSaturation(engine, adj.saturation);
  setImageVibrance(engine, adj.vibrance);
  const pf = adj.photoFilter;
  setImagePhotoFilter(engine, pf.r, pf.g, pf.b, pf.density, true);
}

/** The browser's decode, drawn at most `maxLongEdge` on its long edge (the browser resamples). */
async function decodeToCanvas(source: Blob, maxLongEdge: number | undefined): Promise<{ canvas: HTMLCanvasElement; fullWidth: number; fullHeight: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    const size = limitSize({ width: bitmap.width, height: bitmap.height }, maxLongEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser could not make a canvas to decode into');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return { canvas, fullWidth: bitmap.width, fullHeight: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * The wgpu engine could not start, and the page now runs the WebGL build
 * (renderer-choice.ts `fallBackToWebgl`). The canvas it was given may hold
 * a WebGPU context, which a WebGL engine cannot draw into: start again on a
 * new canvas.
 */
export class RendererChangedError extends Error {
  constructor(cause: unknown) {
    super(`WebGPU could not start (${cause instanceof Error ? cause.message : String(cause)}); the editor now uses WebGL`);
    this.name = 'RendererChangedError';
  }
}

/** wgpu engines being started, and whether one ever started, in this page load. */
const wgpuStarts = new Set<Promise<unknown>>();
let hasStartedWgpu = false;

/**
 * Whether the page can change to WebGL after a wgpu engine failed to
 * start, and does. Only while no wgpu engine exists: the WebGL build
 * cannot drive one, and every engine call would go to it from then on.
 */
async function changeToWebgl(): Promise<boolean> {
  markWgpuFailed();
  await Promise.allSettled([...wgpuStarts]);
  if (hasStartedWgpu) return false;
  return fallBackToWebgl();
}

/**
 * An engine on `canvas`. A wgpu engine that fails to start is recorded for
 * the tab, so a reload runs WebGL; the adapter probe that let wgpu be
 * chosen cannot tell that the device will fail.
 */
async function startEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  await ensureWasm();
  if (rendererName() !== 'wgpu') return createEngine(canvas);
  const start = createEngine(canvas);
  wgpuStarts.add(start);
  try {
    const engine = await start;
    hasStartedWgpu = true;
    return engine;
  } catch (err) {
    wgpuStarts.delete(start);
    if (await changeToWebgl()) throw new RendererChangedError(err);
    throw new Error(`WebGPU could not start (${err instanceof Error ? err.message : String(err)}). Reload the page to use WebGL.`);
  } finally {
    wgpuStarts.delete(start);
  }
}

/** Whether the engine on `canvas` renders to float targets, which the working space and the RAW develop stage need (engine/src/develop). */
function hasFloatTargets(canvas: HTMLCanvasElement): boolean {
  // The wgpu build's targets are always float.
  if (rendererName() === 'wgpu') return true;
  const gl = canvas.getContext('webgl2');
  return gl !== null && gl.getExtension('EXT_color_buffer_float') !== null;
}

export interface DevelopEngineOptions {
  /**
   * The engine draws the Edit view's canvas, which may be HDR: on the wgpu
   * build, while the display reports high dynamic range, it asks for an
   * HDR canvas and follows the status bar's HDR switch. The export
   * renderer's and preview engines leave it off and never ask.
   */
  readonly isScreen?: boolean;
}

/**
 * A develop engine on `canvas`. Rejects with `RendererChangedError` when
 * WebGPU failed and the page changed to WebGL: the caller starts again on
 * a new canvas.
 */
export async function createDevelopEngine(canvas: HTMLCanvasElement, options: DevelopEngineOptions = {}): Promise<DevelopEngine> {
  const engine = await startEngine(canvas);
  setBackgroundColor(engine, 0, 0, 0, 1);
  const hasFloat = hasFloatTargets(canvas);
  // Set once for the engine's life, before the first render. Photos that are
  // not RAW reach the engine as sRGB: the browser's decode into an sRGB 2D
  // canvas converts them, and the engine's PNG and DNG decoders and a Lopsy
  // layer give sRGB-encoded values. On an 8-bit pool linear data would band,
  // so there the working space stays off (plan section 5, decision 9).
  setDevelopWorkingSpace(engine, hasFloat, SRGB);
  noteEngineStarted(hasFloat);
  return new PhotoEngine(engine, canvas, hasFloat, options.isScreen === true);
}

class PhotoEngine implements DevelopEngine {
  private readonly engine: Engine;
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly viewListeners = new Set<(view: View) => void>();
  private isDisposed = false;
  private frameRequest: number | null = null;
  /** Whether the last render shows the engine's current state, so a histogram read needs no render of its own. */
  private isFrameCurrent = false;
  private hasLayer = false;
  private layerId = 'photo-0';
  private layerCount = 0;
  /** The RAW develop stage's defaults for this photo; null for an image that is not RAW. */
  private rawDefaults: RawDevelopSettings | null = null;
  private appliedRawJson: string | null = null;
  private isCropEditing = false;
  /** The straighten angle the layer is turned by, and the copy of the unturned image it is turned from. */
  private appliedAngle = 0;
  private pristineId: string | null = null;
  /** Where the turned layer sits in the framed image's pixels; null when it is not turned. */
  private turnedRect: { x: number; y: number; width: number; height: number } | null = null;
  /** Legacy path: what Curves, Color by hue and Color Grading last sent. */
  private colorKey: string | null = null;
  /** Linear path: what `setDevelopTone`, `setDevelopLook` and `setDevelopCurves` last sent. */
  private toneKey: string | null = null;
  private lookKey: string | null = null;
  private curvesKeyApplied: string | null = null;
  private detailKeyApplied: string | null = null;
  private isInteractive = false;
  /** The crop's corner in framed pixels: where the document starts. */
  private cropOrigin = { x: 0, y: 0 };
  private areasKey: string | null = null;
  /** What each area's layer was last sent as, by the area's place (areaLayerKey). */
  private areaLayerKeys: readonly string[] = [];
  /** The area the Edit view asks to show in red; it shows while no read holds the screen-only views off. */
  private overlayAreaId: string | null = null;
  /** Reads under way with the screen-only views off (withScreenViewsOff). */
  private screenReads = 0;
  /** The working image's width over the full image's: 1 at full resolution. */
  private pixelScale = 1;
  /** The document and layer placement last pushed, to skip unchanged layouts. */
  private layoutKey: string | null = null;
  private wbPresets: WhiteBalancePresetValues[] = [];
  private kelvinScale: KelvinScale | null = null;
  /** The displayed (cropped) size. */
  private displaySize: Size | null = null;
  private autoWb: { temperature: number; tint: number } | null = null;
  private engineProfiles: DevelopProfile[] = [];
  /** Oriented size, before framing. */
  private sourceSize: Size | null = null;
  private framing: Framing = { rotate: 0, flipH: false };
  private recipe: Recipe = DEFAULT_RECIPE;
  private applied: EngineAdjustments | null = null;
  private view: View = { zoom: 1, panX: 0, panY: 0, isFit: true };
  private fitInsets: Insets = NO_INSETS;
  /** The canvas's CSS size and device pixel ratio. */
  private cssSize: Size = { width: 0, height: 0 };
  private pixelRatio = 1;
  private loadAbort: AbortController | null = null;
  private upgradeAbort: AbortController | null = null;
  private upgrade: Promise<void> | null = null;
  /** The original, kept to load the full size on demand. */
  private loaded: { source: Blob; format: ImageFormat } | null = null;
  /** The full image's oriented size, before framing. */
  private fullSize: Size | null = null;

  /** Whether the engine renders to float targets and so edits in the working space. */
  private readonly hasFloat: boolean;
  /** Which develop stages the recipe is sent to, for the engine's life (develop-stages.ts). */
  private readonly path: DevelopPath;
  /** The space the canvas shows the screen in, and the one it holds now (a copied draw changes it for a moment). */
  private screenSpace: CanvasSpace = 'srgb';
  private canvasSpace: CanvasSpace = 'srgb';
  /** Whether the canvas is HDR now (`screenIsHdr`); only ever true on the Edit view's engine. */
  private isHdrCanvas = false;
  /** The Edit view's engine: it may ask for an HDR canvas and follows the HDR switch. */
  private readonly isScreen: boolean;
  /** The HDR switch as last sent to the engine (`setDevelopHdr`). */
  private hdrViewSent: boolean | null = null;
  private readonly stopDisplay: () => void;

  private hasLostGpu = false;
  private readonly lostListeners = new Set<() => void>();
  private readonly handleGpuLost = (event: Event) => {
    // Lets the browser restore the WebGL context, which the Edit view waits for.
    if (event.type === 'webglcontextlost') event.preventDefault();
    if (this.hasLostGpu || this.isDisposed) return;
    this.hasLostGpu = true;
    for (const listener of [...this.lostListeners]) listener();
    this.lostListeners.clear();
  };

  constructor(engine: Engine, canvas: HTMLCanvasElement, hasFloat: boolean, isScreen: boolean) {
    this.engine = engine;
    this.canvas = canvas;
    this.hasFloat = hasFloat;
    this.isScreen = isScreen;
    this.path = developPathFor(hasFloat);
    // Told at start-up whatever the display, then whenever it changes.
    this.screenSpace = this.setCanvasSpace(this.screenSpaceFor(currentStatus().display), this.wantsHdr(currentStatus().display));
    this.noteScreen();
    this.followHdrView();
    this.stopDisplay = onStatusChange(() => {
      this.followDisplay(currentStatus().display);
      this.followHdrView();
    });
    if (rendererName() === 'wgpu') window.addEventListener(GPU_LOST_EVENT, this.handleGpuLost);
    else canvas.addEventListener('webglcontextlost', this.handleGpuLost);
    if (import.meta.env.DEV) window.__photonamousEngine = { rendererName, loseDevice: () => this.loseDevice() };
    this.resizeObserver = new ResizeObserver((entries) => this.handleResize(entries));
    try {
      this.resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(canvas);
    }
    this.measure();
  }

  // ---- loading -------------------------------------------------------

  async load(source: Blob, format: ImageFormat, onProgress?: (progress: LoadProgress) => void, options: LoadOptions = {}): Promise<Size> {
    this.loadAbort?.abort();
    this.upgradeAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const report = (stage: LoadProgress['stage'], fraction: number | null) => {
      if (!abort.signal.aborted) onProgress?.({ stage, fraction });
    };
    try {
      report('reading', null);
      this.setRawDefaults(null);
      this.pixelScale = 1;
      this.loaded = { source, format };
      this.fullSize = null;
      const mode = options.resolution === 'full' ? 'full' : 'working';
      const size = await this.decode(source, format, abort.signal, report, mode);
      if (abort.signal.aborted || this.isDisposed) throw new DecodeAbortedError();
      if (!this.fullSize) this.fullSize = size;
      return size;
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
  }

  /** The long edge the Edit view edits at (spec 6.10): the view's, at least a screen preview's, at most 4096 px. */
  private workingLongEdge(): number {
    return Math.min(MAX_WORKING_EDGE, Math.max(MIN_WORKING_EDGE, Math.round(Math.max(this.canvas.width, this.canvas.height))));
  }

  workingScale(): number {
    return this.pixelScale;
  }

  isFullResolution(): boolean {
    return this.pixelScale >= 1;
  }

  ensureFullResolution(): Promise<void> {
    if (this.isFullResolution() || !this.loaded || !this.sourceSize) return Promise.resolve();
    if (this.upgrade) return this.upgrade;
    const abort = new AbortController();
    this.upgradeAbort = abort;
    const { source, format } = this.loaded;
    const run = async () => {
      try {
        if (format === 'raf') await this.decodeRaf(source, abort.signal, () => undefined, 'upgrade');
        else await this.upgradeImage(source, abort.signal, format);
      } finally {
        if (this.upgradeAbort === abort) this.upgradeAbort = null;
        this.upgrade = null;
        for (const listener of this.viewListeners) listener(this.view);
      }
    };
    this.upgrade = run();
    for (const listener of this.viewListeners) listener(this.view);
    return this.upgrade;
  }

  isLoadingFullResolution(): boolean {
    return this.upgrade !== null;
  }

  private async decode(
    source: Blob,
    format: ImageFormat,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
    mode: 'working' | 'full',
  ): Promise<Size> {
    if (source.type === LOPSY_LAYER_MIME) return this.showImage(await this.decodeLopsyLayer(source, signal, report));
    // Photos sit on opaque black; only a Lopsy layer keeps its transparency.
    setBackgroundColor(this.engine, 0, 0, 0, 1);
    if (format === 'raf') return this.decodeRaf(source, signal, report, mode);
    if (format === 'dng') return this.decodeDng(source, signal, report);
    if (format === 'png' && mode === 'full') {
      const sized = await this.decodePng16(source, signal, report);
      if (sized) return this.showImage(sized);
    }
    if (format === 'lopsy') throw new Error('Lopsy documents open in Lopsy, not in the Edit view');
    report('decoding', null);
    const decoded = await decodeToCanvas(source, mode === 'working' ? this.workingLongEdge() : undefined);
    this.checkLive(signal);
    report('uploading', null);
    const { canvas, fullWidth, fullHeight } = decoded;
    this.resetLayer(canvas.width, canvas.height);
    uploadLayerPixelsFromCanvas(this.engine, this.layerId, canvas, canvas.width, canvas.height);
    this.fullSize = { width: fullWidth, height: fullHeight };
    this.pixelScale = fullWidth > 0 ? canvas.width / fullWidth : 1;
    return this.showImage({ width: canvas.width, height: canvas.height });
  }

  /** The full-size image into a hidden layer that then replaces the working one. */
  private async upgradeImage(source: Blob, signal: AbortSignal, format: ImageFormat): Promise<void> {
    if (format === 'png' && (await this.upgradePng16(source, signal))) return;
    const decoded = await decodeToCanvas(source, undefined);
    this.checkLive(signal);
    const previous = this.sourceSize;
    if (!previous) return;
    const { canvas } = decoded;
    const layer = this.addHiddenLayer(canvas.width, canvas.height);
    uploadLayerPixelsFromCanvas(this.engine, layer, canvas, canvas.width, canvas.height);
    this.swapInLayer(layer, { width: canvas.width, height: canvas.height }, previous);
  }

  /**
   * RAF through the worker pool. Where the GPU renders to float targets the
   * pixels are linear camera RGB for the RAW develop stage, and:
   * - 'working' (the Edit view): only the binned frame, at the working
   *   size, is made; no full-size bands (spec 6.10);
   * - 'full' (exports): the binned frame shows first while the full-size
   *   bands fill a hidden layer that replaces it;
   * - 'upgrade': the full-size bands replace the working image (zoom to
   *   50 % or closer).
   * Without float targets the bands carry the decoder's finished look.
   */
  private async decodeRaf(
    source: Blob,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
    mode: 'working' | 'full' | 'upgrade',
  ): Promise<Size> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    report('decoding', null);
    this.wbPresets = parsePresets(rafWhiteBalancePresets(data));
    this.kelvinScale = parseKelvinScale(rafWhiteBalanceKelvin(data));
    const isLinear = this.hasFloat;
    const isUpgrade = mode === 'upgrade';
    const isWorkingOnly = mode === 'working' && isLinear;
    let quick: Size | null = isUpgrade ? this.sourceSize : null;
    let fullLayer: string | null = null;
    try {
      const meta = await decodeRafInWorkers(
        data,
        (full, band) => {
          if (signal.aborted || this.isDisposed) return;
          if (fullLayer === null) {
            fullLayer = quick ? this.addHiddenLayer(full.width, full.height) : this.resetLayer(full.width, full.height);
          }
          uploadLayerPixelsF32Rect(
            this.engine, fullLayer, full.width, full.height,
            band.x, band.y, band.width, band.height, band.pixels,
          );
        },
        {
          signal,
          linear: isLinear,
          renderBands: !isWorkingOnly,
          ...(isUpgrade ? {} : { binnedLongEdge: isWorkingOnly ? this.workingLongEdge() : QUICK_VIEW_LONG_EDGE }),
          onPrepared: (prepMeta, prepared) => {
            if (signal.aborted || this.isDisposed || !isLinear || isUpgrade) return;
            this.setRawDefaults(parseRawDevelopSettings(prepared.developDefaultsJson));
            this.autoWb = prepared.autoWbRatio ? temperatureTintFor(prepared.autoWbRatio) : null;
            this.engineProfiles = prepared.profilesJson ? parseDevelopProfiles(prepared.profilesJson) : [];
            this.fullSize = { width: prepMeta.width, height: prepMeta.height };
            const binned = prepared.binned;
            if (!binned) return;
            const layer = this.resetLayer(binned.width, binned.height);
            this.pixelScale = prepMeta.width > 0 ? binned.width / prepMeta.width : 1;
            uploadLayerPixelsF32Rect(this.engine, layer, binned.width, binned.height, 0, 0, binned.width, binned.height, binned.pixels);
            quick = this.showImage({ width: binned.width, height: binned.height });
            if (!isWorkingOnly) report('refining', 0);
          },
          onProgress: (p) => {
            const fraction = p.bandCount > 0 ? p.bandsDone / p.bandCount : 0;
            report(quick ? 'refining' : 'decoding', fraction);
          },
        },
      );
      this.checkLive(signal);
      if (meta.width === 0 || meta.height === 0) throw new Error('The RAW file decoded to an empty image');
      const size = { width: meta.width, height: meta.height };
      if (isWorkingOnly) {
        if (!quick) throw new Error('The RAW file decoded to an empty image');
        return quick;
      }
      if (fullLayer === null) throw new Error('The RAW file decoded to an empty image');
      if (quick) {
        this.swapInLayer(fullLayer, size, quick);
        return size;
      }
      return this.showImage(size);
    } catch (err) {
      // A full-size layer filled beside the working image and never swapped in.
      const hidden: string | null = fullLayer;
      if (hidden !== null && hidden !== this.layerId && !this.isDisposed) removeLayer(this.engine, hidden);
      throw err;
    }
  }

  private async decodeDng(
    source: Blob,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
  ): Promise<Size> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    report('decoding', null);
    // The decode blocks this thread: let the progress paint first.
    await nextFrame();
    await nextFrame();
    this.checkLive(signal);
    this.resetLayer(1, 1);
    const meta = JSON.parse(decodeAndUploadDng(this.engine, this.layerId, data)) as { width: number; height: number };
    if (!meta.width || !meta.height) throw new Error('The DNG file decoded to an empty image');
    this.sizeDocument(meta.width, meta.height);
    return this.showImage({ width: meta.width, height: meta.height });
  }

  /** A Lopsy layer blob, straight into the layer texture at full depth. */
  private async decodeLopsyLayer(
    source: Blob,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
  ): Promise<Size> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    if (data.byteLength < 24) throw new Error('The layer from Lopsy is empty');
    const header = new DataView(data.buffer, data.byteOffset, 24);
    const width = header.getInt32(16, true);
    const height = header.getInt32(20, true);
    if (width <= 0 || height <= 0) throw new Error('The layer from Lopsy has no size');
    // The engine allocates the full size the header states.
    if (width * height * 8 > MAX_LOPSY_LAYER_BYTES) throw new Error('The layer from Lopsy is too large to grade');
    report('uploading', null);
    setBackgroundColor(this.engine, 0, 0, 0, 0);
    this.resetLayer(1, 1);
    uploadLayerPixelsCompressedU16(this.engine, this.layerId, data);
    this.sizeDocument(width, height);
    return { width, height };
  }

  /** The engine's PNG decoder keeps 16-bit files at full depth; null when it cannot read the file. */
  private async decodePng16(
    source: Blob,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
  ): Promise<Size | null> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    report('decoding', null);
    this.resetLayer(1, 1);
    const result = decodeAndUploadImage(this.engine, this.layerId, data);
    const [width = 0, height = 0] = result;
    if (result.length < 2 || !width || !height) return null;
    this.sizeDocument(width, height);
    return { width, height };
  }

  /** A PNG's full size at its own depth (16-bit stays 16-bit), into a layer that replaces the working one; false when the engine cannot decode it. */
  private async upgradePng16(source: Blob, signal: AbortSignal): Promise<boolean> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    const previous = this.sourceSize;
    if (!previous) return true;
    const layer = this.addHiddenLayer(1, 1);
    const [width = 0, height = 0] = decodeAndUploadImage(this.engine, layer, data);
    if (!width || !height) {
      removeLayer(this.engine, layer);
      return false;
    }
    this.swapInLayer(layer, { width, height }, previous);
    return true;
  }

  private checkLive(signal: AbortSignal): void {
    if (signal.aborted || this.isDisposed) throw new DecodeAbortedError();
  }

  // ---- the canvas's colour space -----------------------------------------

  /** Display P3 where the display has it and the working space renders for it; sRGB otherwise. */
  private screenSpaceFor(display: DisplayInfo): CanvasSpace {
    return display.isDisplayP3 && this.hasFloat ? 'display-p3' : 'srgb';
  }

  /**
   * Whether to ask for an HDR canvas: only the Edit view's engine, on the
   * wgpu build (WebGL's canvas is 8 bits), with the working space, while
   * the display reports high dynamic range.
   */
  private wantsHdr(display: DisplayInfo): boolean {
    return this.isScreen && this.hasFloat && display.isHdr && rendererName() === 'wgpu';
  }

  /** Moves the canvas to the space (and dynamic range) of the display the window is on now. */
  private followDisplay(display: DisplayInfo): void {
    if (this.isDisposed) return;
    const wanted = this.screenSpaceFor(display);
    const hdr = this.wantsHdr(display);
    if (wanted === this.screenSpace && wanted === this.canvasSpace && hdr === this.isHdrCanvas) return;
    this.screenSpace = this.setCanvasSpace(wanted, hdr);
    this.noteScreen();
    this.invalidate();
  }

  /** The Edit view's engine tells the status bar whether its canvas is HDR. */
  private noteScreen(): void {
    if (this.isScreen && !this.isDisposed) noteScreenHdr(this.isHdrCanvas);
  }

  /** The status bar's HDR switch, sent to the engine when it changes (Edit view only; it shows only on an HDR canvas). */
  private followHdrView(): void {
    if (!this.isScreen || this.isDisposed) return;
    const on = currentStatus().isHdrView;
    if (on === this.hdrViewSent) return;
    this.hdrViewSent = on;
    setDevelopHdr(this.engine, on, HDR_PEAK);
    this.invalidate();
  }

  /**
   * Tags the canvas as `space` and has the engine's output step render for
   * it. On WebGL the page tags the drawing buffer, and a browser without
   * `drawingBufferColorSpace` keeps sRGB; on WebGPU the engine configures
   * the canvas. With `hdr` it asks for an HDR canvas (wgpu only) and learns
   * from `screenIsHdr` whether it got one; a browser that refuses, or a
   * request that throws, leaves the SDR canvas as before. Returns the space
   * the canvas holds afterwards.
   */
  private setCanvasSpace(space: CanvasSpace, hdr = false): CanvasSpace {
    let taken: CanvasSpace = space;
    if (rendererName() === 'webgl') {
      const gl = this.canvas.getContext('webgl2');
      try {
        if (gl) gl.drawingBufferColorSpace = space;
      } catch {
        // Not settable here: the buffer stays as it was.
      }
      taken = gl?.drawingBufferColorSpace === 'display-p3' ? 'display-p3' : 'srgb';
    }
    const isP3 = taken === 'display-p3';
    let isHdr = false;
    if (hdr) {
      try {
        setScreenOutput(this.engine, isP3, true);
        isHdr = screenIsHdr(this.engine);
      } catch {
        isHdr = false;
      }
      if (!isHdr) setScreenOutput(this.engine, isP3, false);
    } else {
      setScreenOutput(this.engine, isP3, false);
    }
    this.isHdrCanvas = isHdr;
    this.canvasSpace = taken;
    return taken;
  }

  /** Shows a freshly loaded image, unframed, fitted, with the recipe applied. */
  private showImage(size: Size): Size {
    this.sourceSize = size;
    this.layoutKey = null;
    this.displaySize = null;
    this.framing = { rotate: 0, flipH: false };
    this.applied = null;
    this.toneKey = null;
    this.lookKey = null;
    this.appliedRawJson = null;
    this.applyRecipe();
    this.fit();
    return size;
  }

  /**
   * Replaces the working image with the full-size layer, keeping the zoom and
   * pan the user chose in the meantime (scaled to the larger image).
   * Everything sized in document pixels or by `pixelScale` is applied
   * again for the new size: framing, straighten, the crop's layout, areas
   * (and the mask overlay), detail, local contrast and Finish.
   */
  private swapInLayer(layer: string, size: Size, previous: Size): void {
    this.unturn();
    this.pixelScale = 1;
    removeLayer(this.engine, this.layerId);
    this.layerId = layer;
    setDocumentSize(this.engine, size.width, size.height);
    updateLayer(this.engine, layerDesc(layer, size.width, size.height, true));
    setLayerOrder(this.engine, JSON.stringify([layer]));
    const wasFit = this.view.isFit;
    const zoom = this.view.zoom * (previous.width / size.width);
    this.sourceSize = size;
    // The new layer is unframed; applyRecipe frames and turns it to the recipe.
    this.framing = { rotate: 0, flipH: false };
    this.forgetSizedState();
    this.applyRecipe();
    if (wasFit) this.fit();
    else this.setView({ ...this.view, zoom, isFit: false });
    this.invalidate();
  }

  /** Forgets what was sent for the old image size, so applyRecipe sends it all again. */
  private forgetSizedState(): void {
    this.layoutKey = null;
    this.areasKey = null;
    // No key an area's layer can have: each place is cleared and sent again.
    this.areaLayerKeys = this.areaLayerKeys.map(() => 'resend');
    this.detailKeyApplied = null;
    this.finishKeyApplied = null;
  }

  private nextLayerId(): string {
    this.layerCount += 1;
    return `photo-${this.layerCount}`;
  }

  /** Replaces the document with one visible layer of this size; returns its id. */
  private resetLayer(width: number, height: number): string {
    this.unturn();
    if (this.hasLayer) removeLayer(this.engine, this.layerId);
    this.layerId = this.nextLayerId();
    setDocumentSize(this.engine, width, height);
    addLayer(this.engine, layerDesc(this.layerId, width, height, true));
    setLayerOrder(this.engine, JSON.stringify([this.layerId]));
    this.hasLayer = true;
    this.invalidate();
    return this.layerId;
  }

  /** A layer outside the layer order, filled while the working image shows. */
  private addHiddenLayer(width: number, height: number): string {
    const id = this.nextLayerId();
    addLayer(this.engine, layerDesc(id, width, height, false));
    return id;
  }

  private sizeDocument(width: number, height: number): void {
    setDocumentSize(this.engine, width, height);
    updateLayer(this.engine, layerDesc(this.layerId, width, height, true));
    this.layoutKey = null;
    this.invalidate();
  }

  /**
   * The crop is the document: a document the size of the crop with the
   * framed layer offset so the crop's corner sits at its origin. Export,
   * previews, the histogram and Edit in Lopsy all read the document, so
   * they all honour the crop, and the vignette lands on the cropped frame.
   */
  private layout(): void {
    if (!this.sourceSize) return;
    const full = framedSize(this.sourceSize.width, this.sourceSize.height, this.framing.rotate);
    const userCrop = this.recipe.framing.crop ? toFramed(this.recipe.framing.crop, this.framing) : null;
    const crop = this.isCropEditing ? null : straightenedCrop(userCrop, this.appliedAngle, full.width, full.height);
    const px = crop && !isFullCrop(crop) ? cropPixels(crop, full.width, full.height) : { x: 0, y: 0, ...full };
    const layer = this.turnedRect ?? { x: 0, y: 0, ...full };
    const key = `${this.layerId}:${full.width}x${full.height}:${px.x},${px.y},${px.width},${px.height}:${layer.x},${layer.y},${layer.width},${layer.height}`;
    if (key === this.layoutKey) return;
    const previous = this.displaySize;
    setDocumentSize(this.engine, px.width, px.height);
    updateLayer(this.engine, layerDesc(this.layerId, layer.width, layer.height, true, layer.x - px.x, layer.y - px.y));
    this.layoutKey = key;
    this.displaySize = { width: px.width, height: px.height };
    this.cropOrigin = { x: px.x, y: px.y };
    this.applyAreas();
    this.invalidate();
    const isResized = !previous || previous.width !== px.width || previous.height !== px.height;
    if (isResized || this.view.isFit) this.fit();
  }

  setCropEditing(isEditing: boolean): void {
    if (this.isCropEditing === isEditing) return;
    this.isCropEditing = isEditing;
    this.layout();
    this.fit();
  }

  // ---- the recipe ----------------------------------------------------

  setRecipe(recipe: Recipe): void {
    this.recipe = recipe;
    if (this.sourceSize) this.applyRecipe();
  }

  private setRawDefaults(defaults: RawDevelopSettings | null): void {
    this.rawDefaults = defaults;
    this.appliedRawJson = null;
    if (!defaults) {
      this.autoWb = null;
      this.engineProfiles = [];
      this.wbPresets = [];
      this.kelvinScale = null;
      clearRawDevelop(this.engine);
    }
  }

  private applyRecipe(): void {
    const stages = developStages(this.recipe, { isRaw: this.rawDefaults !== null, path: this.path });
    if (stages.path === 'linear') this.applyLinearStages(stages);
    else this.applyLegacyStages(stages);
    this.applyDetail();
    this.applyFinish();
    if (this.rawDefaults) {
      const json = rawSettingsJson(rawSettingsFor(this.rawDefaults, this.recipe, this.engineProfiles));
      if (json !== this.appliedRawJson) {
        setRawDevelop(this.engine, json);
        this.appliedRawJson = json;
        this.invalidate();
      }
    }
    this.applyFraming(effectiveFraming(this.recipe.framing));
    this.applyAngle(framingAngle(this.recipe.framing));
    this.layout();
    this.applyAreas();
  }

  areaFrame(): AreaFrame | null {
    if (!this.sourceSize) return null;
    return {
      framing: this.framing,
      angle: this.appliedAngle,
      sourceWidth: this.sourceSize.width,
      sourceHeight: this.sourceSize.height,
      cropX: this.cropOrigin.x,
      cropY: this.cropOrigin.y,
    };
  }

  setAreaOverlay(areaId: string | null): void {
    if (this.overlayAreaId === areaId) return;
    this.overlayAreaId = areaId;
    this.applyAreas();
  }

  /** The recipe's areas in document pixels: re-sent whenever they, the framing or the overlay shown change. */
  private applyAreas(): void {
    const frame = this.areaFrame();
    if (!frame) return;
    const out = areaValues(this.recipe, frame);
    // A read under way keeps the overlay off; the last one to end shows what was asked for meanwhile.
    const overlay = this.screenReads > 0 ? null : this.overlayAreaId;
    // Each area's own layer (its further effects), by its place among the areas.
    const layerOptions = { pixelScale: this.pixelScale, grainSeed: this.grainSeedValue, isInteractive: this.isInteractive };
    const areas = out ? liveAreas(this.recipe) : [];
    const linearLayers = this.path === 'linear' ? areas.map((area) => linearAreaLayerValues(area, layerOptions)) : [];
    const legacyLayers = this.path === 'legacy' ? areas.map((area) => areaLayerValues(area, layerOptions)) : [];
    const layerKeys = this.path === 'linear' ? linearLayers.map(linearAreaLayerKey) : legacyLayers.map(areaLayerKey);
    const key = out ? `${Array.from(out.values).join(',')}|${overlay ?? ''}|${layerKeys.join(';')}` : 'none';
    if (key === this.areasKey) return;
    this.areasKey = key;
    if (out) setImageAreas(this.engine, out.values);
    else clearImageAreas(this.engine);
    // The engine keeps a layer by its area's place. Only a place whose layer changed is sent again: a place
    // that lost its area, or whose area is another one now, is cleared first.
    const sent = out ? this.areaLayerKeys : [];
    for (let index = 0; index < Math.max(sent.length, layerKeys.length); index++) {
      const layerKey = layerKeys[index] ?? '';
      if (layerKey === (sent[index] ?? '')) continue;
      clearImageAreaLayer(this.engine, index);
      const linear = linearLayers[index];
      if (linear) {
        if (linear.look) setDevelopAreaLook(this.engine, index, linear.look);
        const tables = linear.curves();
        if (tables) setDevelopAreaCurves(this.engine, index, tables);
        if (linear.detail) setImageAreaDetail(this.engine, index, linear.detail);
        if (linear.localContrast) setImageAreaLocalContrast(this.engine, index, linear.localContrast);
        if (linear.finish) setImageAreaFinish(this.engine, index, linear.finish);
      }
      const layer = legacyLayers[index];
      if (layer) {
        if (layer.tone) setImageAreaTone(this.engine, index, ...layer.tone);
        if (layer.curves) setImageAreaCurvesLut(this.engine, index, layer.curves);
        if (layer.mixer) setImageAreaColorMixer(this.engine, index, layer.mixer);
        if (layer.grade) setImageAreaColorGrading(this.engine, index, layer.grade);
        if (layer.detail) setImageAreaDetail(this.engine, index, layer.detail);
        if (layer.localContrast) setImageAreaLocalContrast(this.engine, index, layer.localContrast);
        if (layer.finish) setImageAreaFinish(this.engine, index, layer.finish);
      }
    }
    this.areaLayerKeys = layerKeys;
    const index = out && overlay ? out.ids.indexOf(overlay) : -1;
    setImageAreaOverlay(this.engine, index);
    this.invalidate();
  }

  /** Puts the unturned framed image back in the layer and forgets the copy kept for turning it. */
  private unturn(): void {
    if (this.pristineId) {
      if (this.appliedAngle !== 0) duplicateLayerTexture(this.engine, this.pristineId, this.layerId);
      removeLayer(this.engine, this.pristineId);
      this.pristineId = null;
    }
    this.appliedAngle = 0;
    this.turnedRect = null;
    this.layoutKey = null;
  }

  /**
   * Straighten: the layer re-rendered from a kept copy of the framed image,
   * turned about its centre, through the engine's layer transform. The
   * layer grows to the turned bounds; layout() crops inside them.
   */
  private applyAngle(angle: number): void {
    if (angle === this.appliedAngle || !this.sourceSize) return;
    const { width, height } = framedSize(this.sourceSize.width, this.sourceSize.height, this.framing.rotate);
    if (this.pristineId && this.appliedAngle !== 0) duplicateLayerTexture(this.engine, this.pristineId, this.layerId);
    this.layoutKey = null;
    if (angle === 0) {
      this.appliedAngle = 0;
      this.turnedRect = null;
      updateLayer(this.engine, layerDesc(this.layerId, width, height, true));
      this.invalidate();
      return;
    }
    if (!this.pristineId) {
      this.pristineId = this.nextLayerId();
      addLayer(this.engine, layerDesc(this.pristineId, width, height, false));
      duplicateLayerTexture(this.engine, this.layerId, this.pristineId);
    }
    updateLayer(this.engine, layerDesc(this.layerId, width, height, true));
    beginLayerTransform(this.engine, this.layerId, 0, 0, width, height);
    const bounds = rotatedBounds(width, height, angle);
    prepareLayerTransformTarget(this.engine, this.layerId, bounds.x, bounds.y, bounds.width, bounds.height);
    compositeLayerTransformAffine(this.engine, inverseRotation(angle), width / 2, height / 2, width / 2, height / 2);
    dropFloat(this.engine);
    const [x = 0, y = 0, w = width, h = height] = getLayerEngineBounds(this.engine, this.layerId);
    this.turnedRect = { x, y, width: w, height: h };
    this.appliedAngle = angle;
    this.invalidate();
  }

  private clippingWarning = { shadows: false, highlights: false };
  private grainSeedValue = 0;
  private finishKeyApplied: string | null = null;

  private isDetailMaskView = false;

  setDetailMaskView(on: boolean): void {
    this.isDetailMaskView = on;
    if (this.isDisposed) return;
    setImageDetailMaskView(this.engine, on);
    this.invalidate();
  }

  /**
   * Runs `work` with the screen-only views (clipping warning, sharpening
   * mask, the selected mask's red overlay) off, for anything that reads the
   * rendered frame: exports and previews draw it, and the histogram and
   * Auto tone count it. The overlay stays off until the last read ends,
   * even when the Edit view shows or hides it meanwhile (it does on a
   * timer), and then follows the last request. Costs nothing while no view
   * is on.
   */
  private async withScreenViewsOff<T>(work: () => Promise<T>): Promise<T> {
    const { shadows, highlights } = this.clippingWarning;
    const isMask = this.isDetailMaskView;
    const isOverlay = this.overlayAreaId !== null;
    const isAnyOn = shadows || highlights || isMask || isOverlay;
    this.screenReads += 1;
    if (isAnyOn) {
      this.isFrameCurrent = false;
      if (shadows || highlights) engineSetClippingWarning(this.engine, false, false);
      if (isMask) setImageDetailMaskView(this.engine, false);
      if (isOverlay) this.applyAreas();
    }
    try {
      return await work();
    } finally {
      this.screenReads -= 1;
      if (!this.isDisposed) {
        if (isAnyOn) {
          engineSetClippingWarning(this.engine, this.clippingWarning.shadows, this.clippingWarning.highlights);
          setImageDetailMaskView(this.engine, this.isDetailMaskView);
          this.invalidate();
        }
        if (this.screenReads === 0 && (isOverlay || this.overlayAreaId !== null)) this.applyAreas();
      }
    }
  }

  setGrainSeed(seed: number): void {
    if (seed === this.grainSeedValue) return;
    this.grainSeedValue = seed;
    this.applyFinish();
  }

  /** Vignette shape and grain in one engine pass (it replaces setImageVignette); grain scales with the working size. */
  private applyFinish(): void {
    // An area's grain shares the seed.
    this.applyAreas();
    const key = finishKey(this.recipe.finish, this.grainSeedValue, this.pixelScale);
    if (key === this.finishKeyApplied) return;
    this.finishKeyApplied = key;
    const values = finishValues(this.recipe.finish, this.grainSeedValue, this.pixelScale);
    if (values) setImageFinish(this.engine, values);
    else clearImageFinish(this.engine);
    this.invalidate();
  }

  setClippingWarning(shadows: boolean, highlights: boolean): void {
    this.clippingWarning = { shadows, highlights };
    if (this.isDisposed) return;
    engineSetClippingWarning(this.engine, shadows, highlights);
    this.invalidate();
  }

  setInteractive(isInteractive: boolean): void {
    if (this.isInteractive === isInteractive) return;
    this.isInteractive = isInteractive;
    this.applyDetail();
  }

  private applyDetail(): void {
    // An area's sharpening, noise reduction and local contrast wait out a drag too.
    this.applyAreas();
    const key = this.isInteractive ? 'interactive' : detailKey(this.recipe, this.pixelScale);
    if (key === this.detailKeyApplied) return;
    this.detailKeyApplied = key;
    const detail = this.isInteractive ? null : detailValues(this.recipe, this.pixelScale);
    if (detail) setImageDetail(this.engine, detail);
    else clearImageDetail(this.engine);
    const local = this.isInteractive ? null : localContrastValues(this.recipe, this.pixelScale);
    if (local) setImageLocalContrast(this.engine, local);
    else clearImageLocalContrast(this.engine);
    this.invalidate();
  }

  /** The working space's tone, look and curves, each sent only when it changed. */
  private applyLinearStages(stages: LinearStages): void {
    const toneKey = stages.tone.join(',');
    if (toneKey !== this.toneKey) {
      this.toneKey = toneKey;
      setDevelopTone(this.engine, stages.tone);
      this.invalidate();
    }
    const lookKey = stages.look.join(',');
    if (lookKey !== this.lookKey) {
      this.lookKey = lookKey;
      setDevelopLook(this.engine, stages.look);
      this.invalidate();
    }
    if (stages.curvesKey !== this.curvesKeyApplied) {
      this.curvesKeyApplied = stages.curvesKey;
      const tables = stages.curves();
      if (tables) setDevelopCurves(this.engine, tables);
      else clearDevelopCurves(this.engine);
      this.invalidate();
    }
  }

  /** The 8-bit fallback's image adjustments, curves LUT, Color by hue and grade. */
  private applyLegacyStages(stages: LegacyStages): void {
    const adj = stages.adjustments;
    if (!this.applied || !sameAdjustments(adj, this.applied)) {
      pushAdjustments(this.engine, adj);
      this.applied = adj;
      this.invalidate();
    }
    if (stages.colorKey === this.colorKey) return;
    this.colorKey = stages.colorKey;
    const lut = stages.curvesLut();
    if (lut) setImageCurvesLut(this.engine, lut);
    else clearImageCurves(this.engine);
    const mixer = stages.mixer();
    if (mixer) setImageColorMixer(this.engine, mixer);
    else clearImageColorMixer(this.engine);
    const grade = stages.grade();
    if (grade) setImageColorGrading(this.engine, grade);
    else clearImageColorGrading(this.engine);
    this.invalidate();
  }

  private applyFraming(target: Framing): void {
    const ops = framingOps(this.framing, target);
    if (ops.length === 0 || !this.sourceSize) return;
    this.unturn();
    for (const op of ops) {
      if (op.kind === 'flipH') flipLayer(this.engine, this.layerId, true);
      else rotateLayer90(this.engine, this.layerId, op.clockwise);
    }
    this.framing = target;
    this.layoutKey = null;
  }

  photoInfo(): PhotoInfo {
    const isRaw = this.rawDefaults !== null;
    return {
      isRaw,
      autoWhiteBalance: this.autoWb,
      profiles: profilesFor(isRaw, this.engineProfiles),
      whiteBalancePresets: isRaw ? this.wbPresets : [],
      kelvin: isRaw ? this.kelvinScale : null,
    };
  }

  async sampleAt(x: number, y: number): Promise<readonly [number, number, number] | null> {
    const size = this.imageSize();
    if (!size || this.isDisposed || x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
    // One pixel of the composite, which holds the developed, adjusted image:
    // the photo, not the clipping colours, the sharpening mask or a mask's red.
    return this.withScreenViewsOff(async () => {
      this.renderFrameNow();
      const rgba: unknown = await sampleColor(this.engine, Math.floor(x), Math.floor(y), 1);
      if (!(rgba instanceof Uint8Array) || rgba.length < 3) return null;
      return [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0] as const;
    });
  }

  async sampleWhiteBalance(x: number, y: number, radius: number): Promise<{ temperature: number; tint: number } | null> {
    if (!this.sourceSize || this.isDisposed) return null;
    const out = await sampleNeutralWhiteBalance(this.engine, x, y, Math.max(0, Math.min(64, radius)));
    const temperature = out[0];
    const tint = out[1];
    if (temperature === undefined || tint === undefined || !Number.isFinite(temperature) || !Number.isFinite(tint)) return null;
    return { temperature, tint };
  }
  async readHdrHistogram(): Promise<Uint32Array | null> {
    if (!this.sourceSize || this.isDisposed || !this.hasFloat) return null;
    return this.withScreenViewsOff(async () => {
      this.renderFrameNow();
      const bins: unknown = await readHdrHistogram(this.engine, HDR_PEAK);
      return bins instanceof Uint32Array && bins.length === 1024 ? bins : null;
    });
  }

  hdrWhiteBin(): number {
    return hdrHistogramWhiteBin(HDR_PEAK);
  }

  async readHistogram(): Promise<Uint32Array | null> {
    if (!this.sourceSize || this.isDisposed) return null;
    // The histogram counts the photo, not the clipping colours or the sharpening mask.
    return this.withScreenViewsOff(async () => {
      this.renderFrameNow();
      renderCounts.histogramReads += 1;
      const bins: unknown = await readDevelopHistogram(this.engine);
      return bins instanceof Uint32Array && bins.length === 1024 ? bins : null;
    });
  }

  async autoTone(recipe: Recipe): Promise<ToneValues> {
    this.setRecipe(recipe);
    const answerJson = this.path === 'linear' ? await this.autoToneFromScene(recipe) : await this.autoToneFromHistogram(recipe);
    if (answerJson === null) return recipe.tone;
    const answer: unknown = JSON.parse(answerJson);
    if (typeof answer !== 'object' || answer === null) return recipe.tone;
    const v = answer as Record<string, unknown>;
    const num = (key: keyof ToneValues) => (typeof v[key] === 'number' && Number.isFinite(v[key]) ? (v[key] as number) : recipe.tone[key]);
    return {
      exposure: num('exposure'),
      contrast: num('contrast'),
      highlights: num('highlights'),
      shadows: num('shadows'),
      whites: num('whites'),
      blacks: num('blacks'),
    };
  }

  /** The working space's Auto tone: statistics of the scene before the tone pass, with the photo's exposure. */
  private async autoToneFromScene(recipe: Recipe): Promise<string | null> {
    if (!this.sourceSize || this.isDisposed) return null;
    const stats: unknown = await readSceneStatistics(this.engine);
    if (!(stats instanceof Float32Array) || stats.length !== 8) return null;
    return autoToneScene(stats, JSON.stringify(recipe.tone));
  }

  /** The 8-bit fallback's Auto tone, from the displayed histogram. */
  private async autoToneFromHistogram(recipe: Recipe): Promise<string | null> {
    const bins = await this.readHistogram();
    return bins ? engineAutoTone(bins, JSON.stringify(recipe.tone)) : null;
  }

  imageSize(): Size | null {
    if (!this.sourceSize) return null;
    return this.displaySize ?? this.fullImageSize();
  }

  fullImageSize(): Size | null {
    if (!this.sourceSize) return null;
    return framedSize(this.sourceSize.width, this.sourceSize.height, this.framing.rotate);
  }

  fullResolutionSize(): Size | null {
    const shown = this.imageSize();
    if (!shown || this.isFullResolution() || !this.fullSize) return shown;
    const full = framedSize(this.fullSize.width, this.fullSize.height, this.framing.rotate);
    const framed = this.fullImageSize();
    // Uncropped, the full size is known exactly; a crop is scaled up from the working image.
    if (framed && framed.width === shown.width && framed.height === shown.height) return full;
    return { width: Math.round(shown.width / this.pixelScale), height: Math.round(shown.height / this.pixelScale) };
  }

  // ---- the view ------------------------------------------------------

  getView(): View {
    return this.view;
  }

  onViewChange(listener: (view: View) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  fit(): void {
    const image = this.imageSize();
    this.setView(image ? fitView(image, this.cssSize, this.fitInsets) : { zoom: 1, panX: 0, panY: 0, isFit: true });
  }

  setFitInsets(insets: Insets): void {
    const now = this.fitInsets;
    if (now.top === insets.top && now.right === insets.right && now.bottom === insets.bottom && now.left === insets.left) return;
    this.fitInsets = insets;
    if (this.view.isFit) this.fit();
  }

  setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    this.setView(zoomAround(this.view, clampZoom(zoom), this.cssSize, anchor));
  }

  panBy(dx: number, dy: number): void {
    const image = this.imageSize();
    if (!image) return;
    this.setView(panBy(this.view, dx, dy, image, this.cssSize));
  }

  private setView(view: View): void {
    this.view = view;
    if (!this.isFullResolution() && view.zoom * this.pixelScale >= FULL_RESOLUTION_ZOOM && this.loaded) {
      this.ensureFullResolution().catch((err: unknown) => {
        if (!(err instanceof DecodeAbortedError)) console.warn('Photonamous: the full-size image could not be loaded', err);
      });
    }
    this.pushViewport();
    for (const listener of this.viewListeners) listener(view);
  }

  private pushViewport(): void {
    if (this.isDisposed) return;
    const r = this.pixelRatio;
    setViewport(
      this.engine,
      this.view.zoom * r,
      this.view.panX * r,
      this.view.panY * r,
      this.canvas.width,
      this.canvas.height,
    );
    this.invalidate();
  }

  private handleResize(entries: ResizeObserverEntry[]): void {
    const entry = entries[entries.length - 1];
    if (!entry || this.isDisposed) return;
    const device = entry.devicePixelContentBoxSize?.[0];
    const css = entry.contentBoxSize?.[0];
    const cssWidth = css?.inlineSize ?? entry.contentRect.width;
    const cssHeight = css?.blockSize ?? entry.contentRect.height;
    const ratio = window.devicePixelRatio || 1;
    const width = device ? device.inlineSize : Math.round(cssWidth * ratio);
    const height = device ? device.blockSize : Math.round(cssHeight * ratio);
    this.applySize(cssWidth, cssHeight, width, height);
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.applySize(rect.width, rect.height, Math.round(rect.width * ratio), Math.round(rect.height * ratio));
  }

  private applySize(cssWidth: number, cssHeight: number, width: number, height: number): void {
    this.cssSize = { width: cssWidth, height: cssHeight };
    this.pixelRatio = cssWidth > 0 ? width / cssWidth : window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);
    if (this.view.isFit) this.fit();
    else this.setView(this.view);
  }

  // ---- rendering -----------------------------------------------------

  /** One engine render, counted by what it was for (render-counts.ts). */
  private renderFor(kind: RenderKind): void {
    renderCounts[kind] += 1;
    render(this.engine);
    // A render at another size leaves the screen's frame to be drawn again;
    // any other shows the current state, so a pending screen render would repeat it.
    this.isFrameCurrent = kind !== 'offscreen';
    if (this.isFrameCurrent && this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  /** Brings the rendered frame up to date: the pending screen render now, or nothing when it already is. */
  private renderFrameNow(): void {
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
      this.renderFor('screen');
    } else if (!this.isFrameCurrent) {
      this.renderFor('histogram');
    }
  }

  private invalidate(): void {
    this.isFrameCurrent = false;
    if (this.frameRequest !== null || this.isDisposed) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      if (this.isDisposed) return;
      this.renderFor('screen');
    });
  }

  async renderPreview(maxSize: number, quality = 0.85, recipe?: Recipe): Promise<Blob> {
    renderCounts.previewEncodes += 1;
    return this.exportImage({ format: 'jpeg', quality, maxSize, ...(recipe ? { recipe } : {}) });
  }

  async exportImage(options: ExportOptions): Promise<Blob> {
    // Exports and previews draw through the live path too: never with a screen-only view on.
    return this.withScreenViewsOff(() => this.exportClean(options));
  }

  async renderPreviews(maxSizes: readonly number[], quality = 0.85, recipe?: Recipe): Promise<Blob[]> {
    renderCounts.previewEncodes += maxSizes.length;
    return this.withScreenViewsOff(() =>
      this.atSizeWith(Math.max(...maxSizes), recipe, () => {
        const image = this.imageSize();
        if (!image || this.isDisposed) throw new Error('No photo is loaded');
        const outs = maxSizes.map((max) => limitSize(image, max));
        const drawn = this.drawAtSizes(outs);
        // Started before atSizeWith puts the screen's edit back: a fallback renders synchronously first.
        return Promise.all(
          outs.map((out, i) => drawn[i]?.convertToBlob({ type: JPEG_MIME, quality }) ?? this.encodeFromPng16(out, JPEG_MIME, quality)),
        );
      }),
    );
  }

  private exportClean(options: ExportOptions): Promise<Blob> {
    return this.atSizeWith(options.maxSize, options.recipe, () => this.encode(options));
  }

  /**
   * Runs `work` with the full size loaded when an output of long edge
   * `maxSize` (full size when undefined) needs it, and with `recipe`
   * applied, putting the screen's edit back afterwards.
   */
  private async atSizeWith<T>(maxSize: number | undefined, recipe: Recipe | undefined, work: () => Promise<T>): Promise<T> {
    const working = this.imageSize();
    if (working && !this.isFullResolution() && (!maxSize || maxSize > Math.max(working.width, working.height))) {
      await this.ensureFullResolution();
    }
    if (!recipe) return work();
    const shown = this.recipe;
    this.setRecipe(recipe);
    try {
      return await work();
    } finally {
      // Unless the screen's edit changed meanwhile, which then stays.
      if (this.recipe === recipe && !this.isDisposed) this.setRecipe(shown);
    }
  }

  private async encode(options: ExportOptions): Promise<Blob> {
    const image = this.imageSize();
    if (!image || this.isDisposed) throw new Error('No photo is loaded');
    const space = spaceCode(options.colorSpace);
    if (options.format === 'tiff') return this.encodeTiff16(space);
    if (options.format === 'hdr-png' || options.format === 'hdr-jpeg') {
      return this.encodeHdr(options.format, image, options.quality ?? 0.9, options.exif ?? null);
    }
    const out = options.size ?? limitSize(image, options.maxSize);
    const mime = options.format === 'png' ? PNG_MIME : JPEG_MIME;
    const isFullSize = out.width === image.width && out.height === image.height;
    if (options.format === 'png' && isFullSize && options.pngDepth !== 8) return this.encodePng16(space);
    // An 8-bit file in Rec. 2020 would band; the export dialog offers it for 16-bit files only.
    if (space === REC2020) throw new Error('Rec. 2020 is for 16-bit files (TIFF, 16-bit PNG)');
    const drawn = this.drawAtSizes([out], space === DISPLAY_P3 ? 'display-p3' : 'srgb')[0] ?? null;
    const blob = drawn ? await drawn.convertToBlob({ type: mime, quality: options.quality }) : await this.encodeFromPng16(out, mime, options.quality, space);
    return tagColor(blob, space);
  }

  canExportHdr(): boolean {
    return this.hasFloat;
  }

  /**
   * An HDR file of the whole document at its own size (the full size, which
   * `atSizeWith` loads, as for TIFF). The HDR picture is read once
   * (`readHdrOutputF32`, linear Rec. 2020 up to `HDR_PEAK`). The PQ PNG is
   * that picture encoded by the engine. The gain-map JPEG's base is the
   * ordinary sRGB JPEG export at the same size, and its gain map is
   * computed from the HDR picture and the engine's sRGB composite of the
   * same document (`compositeForExport`), then encoded by the browser from
   * the engine's grey PNG, so no pixel passes through TypeScript.
   */
  private async encodeHdr(format: 'hdr-png' | 'hdr-jpeg', image: Size, quality: number, exif: Uint8Array | null): Promise<Blob> {
    if (!this.hasFloat) throw new Error('HDR files need a GPU that renders in floating point, and this one does not. Choose JPEG or PNG.');
    const { width, height } = image;
    try {
      let hdr: Float32Array | null = await readHdrOutputF32(this.engine, HDR_PEAK);
      // The read drew the composite at the document's size; the screen's frame is drawn again.
      this.isFrameCurrent = false;
      this.invalidate();
      if (hdr.length !== width * height * 4) throw new Error(`the HDR picture is ${hdr.length / 4} pixels, not ${width} × ${height}`);
      if (format === 'hdr-png') {
        const bytes = encodePqPng(hdr, width, height, PQ_SDR_WHITE_NITS);
        hdr = null;
        return new Blob([bytes as BlobPart], { type: PNG_MIME });
      }
      const sdr: Uint8Array = await compositeForExport(this.engine);
      this.isFrameCurrent = false;
      if (sdr.length !== width * height * 4) throw new Error(`the SDR picture is ${sdr.length / 4} pixels, not ${width} × ${height}`);
      const map = computeGainMap(hdr, sdr, width, height, SRGB, GAIN_MAP_SCALE);
      hdr = null;
      let mapPng: Uint8Array;
      let metadata: Float64Array;
      let mapSize: Size;
      try {
        mapPng = map.toPng();
        metadata = Float64Array.from(map.metadata);
        mapSize = { width: map.width, height: map.height };
      } finally {
        map.free();
      }
      const base = await this.encode({ format: 'jpeg', quality, colorSpace: 'srgb', size: image });
      const mapJpeg = await encodeGreyJpeg(mapPng, mapSize, quality);
      const baseBytes = insertJpegExif(new Uint8Array(await base.arrayBuffer()), exif);
      const file = assembleGainMapJpeg(baseBytes, mapJpeg, metadata, SRGB);
      return new Blob([file as BlobPart], { type: JPEG_MIME });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `The HDR file could not be made (${reason}). HDR files are made at the full size and need about 16 bytes a pixel of memory; ` +
          'on a large photo the browser may not have that much. A smaller crop, or an ordinary JPEG or PNG, may work.',
      );
    }
  }

  private async encodeTiff16(space: number): Promise<Blob> {
    this.renderFor('readback');
    const bytes = await exportTiff16(this.engine, space);
    return new Blob([bytes as BlobPart], { type: TIFF_MIME });
  }

  /**
   * Has the engine draw the edited image into its own canvas at exactly
   * each of `sizes` and copies each into an OffscreenCanvas, all in one
   * task, so the browser never shows the resized canvas, and the view is
   * rendered back once at the end. Null for a size the GPU cannot make a
   * drawing buffer that large for.
   */
  private drawAtSizes(sizes: readonly Size[], space: CanvasSpace = 'srgb'): (OffscreenCanvas | null)[] {
    const image = this.imageSize();
    if (!image) return sizes.map(() => null);
    // Without the working space no output step renders for P3: the engine's P3 PNG converts instead (encodeFromPng16).
    if (space !== 'srgb' && !this.hasFloat) return sizes.map(() => null);
    const { width: savedW, height: savedH } = this.canvas;
    try {
      // The canvas holds the file's space, in SDR, while it is drawn and copied, so the copy is exact.
      if ((this.canvasSpace !== space || this.isHdrCanvas) && this.setCanvasSpace(space) !== space) return sizes.map(() => null);
      return sizes.map((size) => this.drawOne(image, size, space));
    } finally {
      const hdr = this.wantsHdr(currentStatus().display);
      if (this.canvasSpace !== this.screenSpace || this.isHdrCanvas !== hdr) {
        this.setCanvasSpace(this.screenSpace, hdr);
        this.noteScreen();
      }
      this.canvas.width = savedW;
      this.canvas.height = savedH;
      this.pushViewport();
      this.renderFor('restore');
    }
  }

  private drawOne(image: Size, size: Size, space: CanvasSpace): OffscreenCanvas | null {
    if (!this.canDrawAt(size)) return null;
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    if (rendererName() === 'webgl') {
      // WebGL may give a smaller drawing buffer than the canvas asks for.
      const gl = this.canvas.getContext('webgl2');
      if (!gl || gl.drawingBufferWidth !== size.width || gl.drawingBufferHeight !== size.height) return null;
    }
    setViewport(this.engine, size.width / image.width, 0, 0, size.width, size.height);
    this.renderFor('offscreen');
    const out = new OffscreenCanvas(size.width, size.height);
    // The same space as the canvas, so drawImage copies the numbers and converts nothing.
    const ctx = out.getContext('2d', { colorSpace: space });
    if (!ctx) return null;
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  /**
   * Whether the canvas can be drawn at `size`. A WebGPU canvas is as large
   * as the device's largest texture (the adapter's, which the engine asks
   * for), and the copy taken from it in `drawOne` is exact; the WebGL
   * drawing buffer is checked after the resize instead.
   */
  private canDrawAt(size: Size): boolean {
    if (rendererName() !== 'wgpu') return true;
    const limit = webGpuTextureLimit() ?? WEBGPU_DEFAULT_TEXTURE_LIMIT;
    return size.width <= limit && size.height <= limit;
  }

  private async encodePng16(space = SRGB): Promise<Blob> {
    this.renderFor('readback');
    const bytes = await exportPng16(this.engine, space);
    return new Blob([bytes as BlobPart], { type: PNG_MIME });
  }

  /** For outputs larger than a drawing buffer: the engine's PNG, resized and re-encoded by the browser. */
  private async encodeFromPng16(size: Size, mime: string, quality: number | undefined, space = SRGB): Promise<Blob> {
    const png = await this.encodePng16(space);
    const bitmap = await createImageBitmap(png, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
    try {
      const out = new OffscreenCanvas(size.width, size.height);
      // A P3 canvas keeps the P3 PNG's colours and tags the encoded file as Display P3.
      const ctx = out.getContext('2d', { colorSpace: space === DISPLAY_P3 ? 'display-p3' : 'srgb' });
      if (!ctx) throw new Error('The browser could not make a canvas to encode with');
      ctx.drawImage(bitmap, 0, 0);
      return out.convertToBlob({ type: mime, quality });
    } finally {
      bitmap.close();
    }
  }

  rendererName(): Renderer {
    return rendererName();
  }

  /** Development builds: loses the GPU as a crash would, for e2e tests of the recovery. */
  private loseDevice(): boolean {
    if (rendererName() === 'wgpu') return loseGpuDevice(this.engine);
    const lose = this.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return lose !== undefined && lose !== null;
  }

  isLost(): boolean {
    return this.hasLostGpu;
  }

  onLost(listener: () => void): () => void {
    if (this.hasLostGpu) {
      listener();
      return () => undefined;
    }
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  dispose(): void {
    if (this.isDisposed) return;
    if (this.isScreen) noteScreenHdr(false);
    this.isDisposed = true;
    this.stopDisplay();
    window.removeEventListener(GPU_LOST_EVENT, this.handleGpuLost);
    this.canvas.removeEventListener('webglcontextlost', this.handleGpuLost);
    this.lostListeners.clear();
    this.loadAbort?.abort();
    this.upgradeAbort?.abort();
    this.resizeObserver.disconnect();
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.viewListeners.clear();
    this.engine.free();
  }
}
