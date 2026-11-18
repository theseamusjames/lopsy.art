/**
 * The engine bridge for one photo: the Edit view's canvas, one image
 * layer, and the recipe mapped onto the engine's document adjustments
 * (recipe-to-adjustments.ts). It calls the wasm exports directly, without
 * Lopsy's stores or engine-sync.
 *
 * Pixels never come into TypeScript. Decoded images go straight to the
 * layer texture (RAF bands from the worker pool, DNG and 16-bit PNG through
 * the engine's decoders, other formats from a canvas the browser decoded
 * into). Previews and exports are drawn by the engine into its own canvas at
 * the output size and handed to `OffscreenCanvas.convertToBlob`; full-size
 * PNG uses the engine's 16-bit encoder.
 */

import initWasm, {
  addLayer,
  autoTone as engineAutoTone,
  clearImageDetail,
  clearImageLocalContrast,
  setImageDetail,
  setImageLocalContrast,
  beginLayerTransform,
  compositeLayerTransformAffine,
  dropFloat,
  duplicateLayerTexture,
  getLayerEngineBounds,
  prepareLayerTransformTarget,
  clearImageColorGrading,
  clearImageColorMixer,
  clearImageCurves,
  clearRawDevelop,
  createEngine,
  decodeAndUploadDng,
  decodeAndUploadImage,
  exportPng16,
  exportTiff16,
  resumeTask,
  flipLayer,
  readDevelopHistogram,
  removeLayer,
  render,
  rotateLayer90,
  setBackgroundColor,
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
  setImageVignette,
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
import type { ImageFormat } from '@lopsy/photos-core/library/types';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import {
  framedSize,
  effectiveFraming,
  framingAngle,
  framingOps,
  recipeToAdjustments,
  sameAdjustments,
  type EngineAdjustments,
  type Framing,
} from './recipe-to-adjustments';
import { cropPixels, inverseRotation, isFullCrop, rotatedBounds, straightenedCrop, toFramed } from './crop';
import { detailKey, detailValues, localContrastValues } from './detail-controls';
import { colorControlsKey, colorGradeValues, colorMixerValues, curvesLut } from './color-controls';
import { clampZoom, fitView, limitSize, panBy, zoomAround, type Size, type View } from './viewport';
import { decodeRafInWorkers, DecodeAbortedError } from './raf/raf-decode';
import { parseRawDevelopSettings, rawSettingsFor, rawSettingsJson, temperatureTintFor, type RawDevelopSettings } from './raw-develop';
import { parseDevelopProfiles, profilesFor, type DevelopProfile } from './profiles';

export { DecodeAbortedError };

export interface LoadProgress {
  /** 'refining': a first view is on screen while the full-size image is decoded. */
  readonly stage: 'reading' | 'decoding' | 'uploading' | 'refining';
  /** 0..1 when known. */
  readonly fraction: number | null;
}

export interface ExportOptions {
  /** 'tiff' is the engine's 16-bit TIFF, always full size. */
  readonly format: 'jpeg' | 'png' | 'tiff';
  /** JPEG quality, 0..1. */
  readonly quality?: number;
  /** Limit on the long edge, in pixels. Full size when omitted. Ignored for TIFF. */
  readonly maxSize?: number;
  /** sRGB when omitted. The engine knows sRGB and Display P3 only. */
  readonly colorSpace?: 'srgb' | 'display-p3';
}

/** What the loaded photo offers the Edit view. */
export interface PhotoInfo {
  /** Developed by the engine's RAW stage: white balance in camera space, profiles. */
  readonly isRaw: boolean;
  /** Auto white balance's answer, as slider values; null when there is none (not RAW). */
  readonly autoWhiteBalance: { readonly temperature: number; readonly tint: number } | null;
  /** The Profile menu. */
  readonly profiles: readonly DevelopProfile[];
}

export type ToneValues = Recipe['tone'];

export interface DevelopEngine {
  photoInfo(): PhotoInfo;
  /** 4 × 256 bins (R, G, B, luminance) of the displayed render; null when the engine cannot read one now. */
  readHistogram(): Promise<Uint32Array | null>;
  /** Auto tone for `recipe`: renders it, reads its histogram and returns the tone values the engine suggests. */
  autoTone(recipe: Recipe): Promise<ToneValues>;
  /** Decodes `source` into the engine, replacing any image already loaded. Resolves with its oriented size. */
  load(source: Blob, format: ImageFormat, onProgress?: (progress: LoadProgress) => void): Promise<Size>;
  /** Renders `recipe` from the next frame on. Cheap when nothing changed. */
  setRecipe(recipe: Recipe): void;
  /** The size the image is shown and exported at: framed, then cropped. Null before a load. */
  imageSize(): Size | null;
  /** The framed image before the crop. */
  fullImageSize(): Size | null;
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
  getView(): View;
  /** Called after every view change (zoom, pan, fit, resize). */
  onViewChange(listener: (view: View) => void): () => void;
  fit(): void;
  /** `anchor` is in CSS pixels from the canvas's top-left. */
  setZoom(zoom: number, anchor?: { x: number; y: number }): void;
  /** CSS pixels. */
  panBy(dx: number, dy: number): void;
  /** A JPEG of the current edit, long edge at most `maxSize`. */
  renderPreview(maxSize: number, quality?: number): Promise<Blob>;
  exportImage(options: ExportOptions): Promise<Blob>;
  dispose(): void;
}

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
const JPEG_MIME = 'image/jpeg';
const PNG_MIME = 'image/png';
const SRGB = 0;
const DISPLAY_P3 = 1;
const TIFF_MIME = 'image/tiff';

interface PendingReadback {
  readonly lopsyTask: number;
  readonly ready: Promise<void>;
}

function isPendingReadback(value: unknown): value is PendingReadback {
  return typeof value === 'object' && value !== null && 'lopsyTask' in value;
}

/**
 * A GPU readback as a Promise, like lopsy-web's `asyncReadback`: WebGL
 * answers at once; a wgpu build parks the read, which this waits out.
 */
async function readback<T>(engine: Engine, read: () => unknown, isDisposed: () => boolean): Promise<T> {
  let step: unknown = read();
  while (isPendingReadback(step)) {
    await step.ready;
    if (isDisposed()) throw new Error('The engine was released while it was exporting');
    step = resumeTask(engine, step.lopsyTask);
  }
  return step as T;
}

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = initWasm().catch((err: unknown) => {
      wasmReady = null;
      throw err;
    });
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
  setImageVignette(engine, adj.vignette);
  const pf = adj.photoFilter;
  setImagePhotoFilter(engine, pf.r, pf.g, pf.b, pf.density, true);
}

async function decodeToCanvas(source: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser could not make a canvas to decode into');
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function createDevelopEngine(canvas: HTMLCanvasElement): Promise<DevelopEngine> {
  await ensureWasm();
  const engine = createEngine(canvas);
  setBackgroundColor(engine, 0, 0, 0, 1);
  return new PhotoEngine(engine, canvas);
}

class PhotoEngine implements DevelopEngine {
  private readonly engine: Engine;
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly viewListeners = new Set<(view: View) => void>();
  private isDisposed = false;
  private frameRequest: number | null = null;
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
  /** What Curves, Color by hue and Color Grading last sent. */
  private colorKey: string | null = null;
  private detailKeyApplied: string | null = null;
  private isInteractive = false;
  /** The working image's width over the full image's: below 1 while a RAW file's first view shows. */
  private pixelScale = 1;
  /** The document and layer placement last pushed, to skip unchanged layouts. */
  private layoutKey: string | null = null;
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
  /** The canvas's CSS size and device pixel ratio. */
  private cssSize: Size = { width: 0, height: 0 };
  private pixelRatio = 1;
  private loadAbort: AbortController | null = null;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.canvas = canvas;
    this.resizeObserver = new ResizeObserver((entries) => this.handleResize(entries));
    try {
      this.resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(canvas);
    }
    this.measure();
  }

  // ---- loading -------------------------------------------------------

  async load(source: Blob, format: ImageFormat, onProgress?: (progress: LoadProgress) => void): Promise<Size> {
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const report = (stage: LoadProgress['stage'], fraction: number | null) => {
      if (!abort.signal.aborted) onProgress?.({ stage, fraction });
    };
    try {
      report('reading', null);
      this.setRawDefaults(null);
      this.pixelScale = 1;
      const size = await this.decode(source, format, abort.signal, report);
      if (abort.signal.aborted || this.isDisposed) throw new DecodeAbortedError();
      return size;
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
  }

  private async decode(
    source: Blob,
    format: ImageFormat,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
  ): Promise<Size> {
    if (source.type === LOPSY_LAYER_MIME) return this.showImage(await this.decodeLopsyLayer(source, signal, report));
    // Photos sit on opaque black; only a Lopsy layer keeps its transparency.
    setBackgroundColor(this.engine, 0, 0, 0, 1);
    if (format === 'raf') return this.decodeRaf(source, signal, report);
    if (format === 'dng') return this.decodeDng(source, signal, report);
    if (format === 'png') {
      const sized = await this.decodePng16(source, signal, report);
      if (sized) return this.showImage(sized);
    }
    if (format === 'lopsy') throw new Error('Lopsy documents open in Lopsy, not in the Edit view');
    report('decoding', null);
    const decoded = await decodeToCanvas(source);
    this.checkLive(signal);
    report('uploading', null);
    this.resetLayer(decoded.width, decoded.height);
    uploadLayerPixelsFromCanvas(this.engine, this.layerId, decoded, decoded.width, decoded.height);
    return this.showImage({ width: decoded.width, height: decoded.height });
  }

  /**
   * RAF through the worker pool. Where the GPU renders to float targets,
   * the bands are linear camera RGB for the RAW develop stage, and a binned
   * first view of the whole frame is shown while the full-size bands are
   * rendered into a hidden layer that replaces it at the end. Elsewhere the
   * bands carry the decoder's finished look.
   */
  private async decodeRaf(
    source: Blob,
    signal: AbortSignal,
    report: (stage: LoadProgress['stage'], fraction: number | null) => void,
  ): Promise<Size> {
    const data = new Uint8Array(await source.arrayBuffer());
    this.checkLive(signal);
    report('decoding', null);
    const isLinear = this.hasFloatTargets();
    let quick: Size | null = null;
    let fullLayer: string | null = null;
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
        binnedLongEdge: QUICK_VIEW_LONG_EDGE,
        onPrepared: (prepMeta, prepared) => {
          if (signal.aborted || this.isDisposed || !isLinear) return;
          this.setRawDefaults(parseRawDevelopSettings(prepared.developDefaultsJson));
          this.autoWb = prepared.autoWbRatio ? temperatureTintFor(prepared.autoWbRatio) : null;
          this.engineProfiles = prepared.profilesJson ? parseDevelopProfiles(prepared.profilesJson) : [];
          const binned = prepared.binned;
          if (!binned) return;
          const layer = this.resetLayer(binned.width, binned.height);
          this.pixelScale = prepMeta.width > 0 ? binned.width / prepMeta.width : 1;
          uploadLayerPixelsF32Rect(this.engine, layer, binned.width, binned.height, 0, 0, binned.width, binned.height, binned.pixels);
          quick = this.showImage({ width: binned.width, height: binned.height });
          report('refining', 0);
        },
        onProgress: (p) => {
          const fraction = p.bandCount > 0 ? p.bandsDone / p.bandCount : 0;
          report(quick ? 'refining' : 'decoding', fraction);
        },
      },
    );
    this.checkLive(signal);
    if (meta.width === 0 || meta.height === 0 || fullLayer === null) throw new Error('The RAW file decoded to an empty image');
    const size = { width: meta.width, height: meta.height };
    if (quick) {
      this.swapInLayer(fullLayer, size, quick);
      return size;
    }
    return this.showImage(size);
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

  private checkLive(signal: AbortSignal): void {
    if (signal.aborted || this.isDisposed) throw new DecodeAbortedError();
  }

  /** Whether the composite is float, which the RAW develop stage needs (engine/src/develop). */
  private hasFloatTargets(): boolean {
    const gl = this.canvas.getContext('webgl2');
    // No WebGL context means the wgpu build, whose targets are always float.
    if (!gl) return true;
    return gl.getExtension('EXT_color_buffer_float') !== null;
  }

  /** Shows a freshly loaded image, unframed, fitted, with the recipe applied. */
  private showImage(size: Size): Size {
    this.sourceSize = size;
    this.layoutKey = null;
    this.displaySize = null;
    this.framing = { rotate: 0, flipH: false };
    this.applied = null;
    this.appliedRawJson = null;
    this.applyRecipe();
    this.fit();
    return size;
  }

  /**
   * Replaces the first view with the full-size layer, keeping the zoom and
   * pan the user chose in the meantime (scaled to the larger image) and
   * re-applying the framing to the new layer.
   */
  private swapInLayer(layer: string, size: Size, previous: Size): void {
    this.unturn();
    this.pixelScale = 1;
    removeLayer(this.engine, this.layerId);
    this.layerId = layer;
    setDocumentSize(this.engine, size.width, size.height);
    updateLayer(this.engine, layerDesc(layer, size.width, size.height, true));
    setLayerOrder(this.engine, JSON.stringify([layer]));
    const target = this.framing;
    const wasFit = this.view.isFit;
    const zoom = this.view.zoom * (previous.width / size.width);
    this.sourceSize = size;
    this.framing = { rotate: 0, flipH: false };
    this.layoutKey = null;
    this.applyFraming(target);
    this.layout();
    if (wasFit) this.fit();
    else this.setView({ ...this.view, zoom, isFit: false });
    this.invalidate();
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

  /** A layer outside the layer order, filled while the first view shows. */
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
      clearRawDevelop(this.engine);
    }
  }

  private applyRecipe(): void {
    const adj = recipeToAdjustments(this.recipe, { isRaw: this.rawDefaults !== null });
    if (!this.applied || !sameAdjustments(adj, this.applied)) {
      pushAdjustments(this.engine, adj);
      this.applied = adj;
      this.invalidate();
    }
    this.applyColorControls();
    this.applyDetail();
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

  setInteractive(isInteractive: boolean): void {
    if (this.isInteractive === isInteractive) return;
    this.isInteractive = isInteractive;
    this.applyDetail();
  }

  private applyDetail(): void {
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

  private applyColorControls(): void {
    const key = colorControlsKey(this.recipe);
    if (key === this.colorKey) return;
    this.colorKey = key;
    const lut = curvesLut(this.recipe);
    if (lut) setImageCurvesLut(this.engine, lut);
    else clearImageCurves(this.engine);
    const mixer = colorMixerValues(this.recipe);
    if (mixer) setImageColorMixer(this.engine, mixer);
    else clearImageColorMixer(this.engine);
    const grade = colorGradeValues(this.recipe);
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
    return { isRaw, autoWhiteBalance: this.autoWb, profiles: profilesFor(isRaw, this.engineProfiles) };
  }

  async readHistogram(): Promise<Uint32Array | null> {
    if (!this.sourceSize || this.isDisposed) return null;
    render(this.engine);
    // WebGL answers at once; a wgpu build parks the read, which this POC does not wait for.
    const bins: unknown = readDevelopHistogram(this.engine);
    return bins instanceof Uint32Array && bins.length === 1024 ? bins : null;
  }

  async autoTone(recipe: Recipe): Promise<ToneValues> {
    this.setRecipe(recipe);
    const bins = await this.readHistogram();
    if (!bins) return recipe.tone;
    const answer: unknown = JSON.parse(engineAutoTone(bins, JSON.stringify(recipe.tone)));
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

  imageSize(): Size | null {
    if (!this.sourceSize) return null;
    return this.displaySize ?? this.fullImageSize();
  }

  fullImageSize(): Size | null {
    if (!this.sourceSize) return null;
    return framedSize(this.sourceSize.width, this.sourceSize.height, this.framing.rotate);
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
    this.setView(image ? fitView(image, this.cssSize) : { zoom: 1, panX: 0, panY: 0, isFit: true });
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

  private invalidate(): void {
    if (this.frameRequest !== null || this.isDisposed) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      if (this.isDisposed) return;
      render(this.engine);
    });
  }

  async renderPreview(maxSize: number, quality = 0.85): Promise<Blob> {
    return this.exportImage({ format: 'jpeg', quality, maxSize });
  }

  async exportImage(options: ExportOptions): Promise<Blob> {
    const image = this.imageSize();
    if (!image || this.isDisposed) throw new Error('No photo is loaded');
    const space = options.colorSpace === 'display-p3' ? DISPLAY_P3 : SRGB;
    if (options.format === 'tiff') return this.encodeTiff16(space);
    const out = limitSize(image, options.maxSize);
    const mime = options.format === 'png' ? PNG_MIME : JPEG_MIME;
    const isFullSize = out.width === image.width && out.height === image.height;
    if (options.format === 'png' && isFullSize) return this.encodePng16(space);
    // The drawing buffer is sRGB; Display P3 goes through the engine's P3 PNG instead.
    const drawn = space === SRGB ? this.drawAtSize(out) : null;
    if (drawn) return drawn.convertToBlob({ type: mime, quality: options.quality });
    return this.encodeFromPng16(out, mime, options.quality, space);
  }

  private async encodeTiff16(space: number): Promise<Blob> {
    render(this.engine);
    const bytes = await readback<Uint8Array>(this.engine, () => exportTiff16(this.engine, space), () => this.isDisposed);
    return new Blob([bytes as BlobPart], { type: TIFF_MIME });
  }

  /**
   * Has the engine draw the edited image into its own canvas at exactly
   * `size` and copies that into an OffscreenCanvas, all in one task, so the
   * browser never shows the resized canvas. Null when the GPU cannot make a
   * drawing buffer that large.
   */
  private drawAtSize(size: Size): OffscreenCanvas | null {
    const image = this.imageSize();
    if (!image) return null;
    const { width: savedW, height: savedH } = this.canvas;
    try {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
      const gl = this.canvas.getContext('webgl2');
      if (!gl || gl.drawingBufferWidth !== size.width || gl.drawingBufferHeight !== size.height) return null;
      setViewport(this.engine, size.width / image.width, 0, 0, size.width, size.height);
      render(this.engine);
      const out = new OffscreenCanvas(size.width, size.height);
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(this.canvas, 0, 0);
      return out;
    } finally {
      this.canvas.width = savedW;
      this.canvas.height = savedH;
      this.pushViewport();
      render(this.engine);
    }
  }

  private async encodePng16(space = SRGB): Promise<Blob> {
    render(this.engine);
    const bytes = await readback<Uint8Array>(this.engine, () => exportPng16(this.engine, space), () => this.isDisposed);
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

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.loadAbort?.abort();
    this.resizeObserver.disconnect();
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.viewListeners.clear();
    this.engine.free();
  }
}
