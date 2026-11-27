/**
 * The export renderer (photos-core export/types.ts) on the engine: its own
 * DevelopEngine on a canvas that is never shown, so exports run without the
 * Edit view. The engine is kept between items (and a photo loaded twice in
 * a row is decoded once) and released after a short idle.
 */

import { colorSpacesFor, isAlwaysFullSize, isHdrFormat, type ExportRenderer, type ExportSettings } from '@lopsy/photos-core/export/types';
import type { Asset, Version } from '@lopsy/photos-core/library/types';
import type { DevelopEngine } from './develop-engine';
import { buildExportExif } from '@lopsy/photos-core/export/exif-writer';
import { extrasOf, outputSize } from '../library/export-size';
import { developSource } from '../library/develop-source';
import { grainSeed } from './finish-controls';
import type { Size } from './viewport';

export interface EngineExportRendererOptions {
  readonly loadOriginal: (asset: Asset, signal: AbortSignal) => Promise<Blob>;
  /** How long the engine is kept after the last render; 20 s by default. */
  readonly idleMs?: number;
  /** Test seam; the real engine by default. */
  readonly createEngine?: (canvas: HTMLCanvasElement) => Promise<DevelopEngine>;
  /**
   * Told when an export of a photo larger than the GPU can edit, meant to
   * be made at its own size in tiles, was made at the held size instead
   * (`ExportOptions.onReduced`): a sentence for the person.
   */
  readonly onNote?: (note: string) => void;
}

export class ExportAbortedError extends Error {
  constructor() {
    super('The export was cancelled');
    this.name = 'AbortError';
  }
}

const DEFAULT_IDLE_MS = 20_000;

function hiddenCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

/**
 * The engine module (and its wasm) loads with the first export, not with
 * the app. When WebGPU fails to start and the page changes to WebGL, the
 * engine is made again on a new canvas (develop-engine.ts `RendererChangedError`).
 * Its canvas is never shown, so it makes the exports of a photo larger than
 * the GPU can edit at the photo's own size, in tiles, on the same engine:
 * a second engine would double the GPU memory on exactly the devices with
 * least of it.
 */
async function createRealEngine(canvas: HTMLCanvasElement): Promise<DevelopEngine> {
  const m = await import('./develop-engine');
  try {
    return await m.createDevelopEngine(canvas, { tiledExports: true });
  } catch (err) {
    if (err instanceof m.RendererChangedError) return m.createDevelopEngine(hiddenCanvas(), { tiledExports: true });
    throw err;
  }
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportAbortedError();
}

/** The version's previews at the grid's and Single view's sizes (photos-core PREVIEW_SIZES). */
export interface RenderedPreviews {
  readonly thumb: Blob;
  readonly screen: Blob;
}

export interface EngineRenderer extends ExportRenderer {
  /**
   * Renders a version's thumb and screen previews on the same engine as
   * exports, after any export queued before it (one render at a time).
   */
  renderPreviews(asset: Asset, version: Version, signal: AbortSignal): Promise<RenderedPreviews>;
  dispose(): void;
}

const THUMB_LONG_EDGE = 512;
const SCREEN_LONG_EDGE = 2048;

export function createEngineExportRenderer(options: EngineExportRendererOptions): EngineRenderer {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const create = options.createEngine ?? createRealEngine;
  let engine: Promise<DevelopEngine> | null = null;
  let loadedAssetId: string | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let isDisposed = false;
  let pending = 0;

  const release = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = engine;
    engine = null;
    loadedAssetId = null;
    current?.then((e) => e.dispose()).catch(() => undefined);
  };

  const getEngine = (): Promise<DevelopEngine> => {
    if (!engine) {
      engine = create(hiddenCanvas());
      engine.catch(() => {
        engine = null;
      });
    }
    return engine;
  };

  /**
   * The engine with `asset` loaded at least at `resolution`: a photo loaded
   * at the working size is brought up to full size in place when a larger
   * output needs it.
   */
  const loaded = async (asset: Asset, signal: AbortSignal, resolution: 'working' | 'full'): Promise<DevelopEngine> => {
    checkSignal(signal);
    if (isDisposed) throw new Error('The export renderer was disposed');
    let e = await getEngine();
    if (e.isLost()) {
      // The GPU was lost since the last render: a new engine, with nothing loaded.
      release();
      e = await getEngine();
    }
    checkSignal(signal);
    if (loadedAssetId !== asset.id) {
      loadedAssetId = null;
      const source = developSource(asset);
      const original = await options.loadOriginal(source, signal);
      checkSignal(signal);
      await e.load(original, source.format, undefined, { resolution });
      loadedAssetId = asset.id;
      checkSignal(signal);
    } else if (resolution === 'full' && !e.isFullResolution()) {
      await e.ensureFullResolution();
      checkSignal(signal);
    }
    e.setGrainSeed(grainSeed(asset.id));
    return e;
  };

  const renderOne = async (asset: Asset, version: Version, settings: ExportSettings, signal: AbortSignal): Promise<Blob> => {
    // A small export can come from the working image; anything larger, and every TIFF, needs the full size.
    // Sizes by short edge or megapixels, and enlarging, are worked out from the full image.
    const extras = extrasOf(settings);
    const byLongEdge = (extras.size.mode === 'original' || extras.size.mode === 'long') && !extras.allowEnlarge;
    const fullSize = isAlwaysFullSize(settings.format);
    const isSmall = byLongEdge && !fullSize && settings.maxLongEdge !== null && settings.maxLongEdge <= 2048;
    const e = await loaded(asset, signal, isSmall ? 'working' : 'full');
    e.setRecipe(version.recipe);
    const image = e.imageSize();
    // A photo larger than the GPU can edit: sizes are worked out from its own size, which tiles make,
    // and from the held image for an export that is not made in tiles (develop-engine.ts `reducedSize`).
    const own = e.tiledExportSize();
    const tiles = (sized: (base: Size) => Size | null) => {
      if (!own || !image) return {};
      // What the engine is asked for without tiles: a size only where it is not the held image's own.
      const reduced = sized(image);
      const reducedSize = reduced && (reduced.width !== image.width || reduced.height !== image.height) ? reduced : null;
      return { signal, onReduced: (note: string) => options.onNote?.(note), reducedSize };
    };
    if (isHdrFormat(settings.format)) {
      if (!e.canExportHdr()) throw new Error('HDR files need a GPU that renders in floating point, and this one does not. Choose JPEG or PNG.');
      // The engine reduces the HDR picture but cannot enlarge it, so an HDR file is never enlarged (photos-core exportSettingsProblem).
      const hdrSized = (base: Size) => outputSize(base, { ...extras, allowEnlarge: false });
      const base = own ?? image;
      const hdrSize = base ? hdrSized(base) : null;
      // The gain-map JPEG's EXIF goes into its base picture before assembly (photos-core metadataWrittenByRenderer).
      const exif = settings.format === 'hdr-jpeg' ? buildExportExif(asset, settings) : null;
      const blob = await e.exportImage({
        format: settings.format,
        quality: settings.quality,
        exif,
        maxSize: settings.maxLongEdge ?? undefined,
        ...(hdrSize && base && (own || hdrSize.width !== base.width || hdrSize.height !== base.height) ? { size: hdrSize } : {}),
        ...tiles(hdrSized),
      });
      checkSignal(signal);
      return blob;
    }
    const space = settings.colorSpace ?? 'srgb';
    const base = own ?? image;
    const sized = (from: Size) => (fullSize ? null : outputSize(from, extras));
    const size = base ? sized(base) : null;
    // Before the engine draws: an 8-bit file in Rec. 2020 bands (photos-core colorSpacesFor).
    if (!colorSpacesFor(settings.format, extras.pngDepth).includes(space)) throw new Error('Rec. 2020 needs a 16-bit file (TIFF, or a 16-bit PNG).');
    const blob = await e.exportImage({
      format: settings.format,
      quality: settings.quality,
      // The engine's TIFF is the full image; the dialog says so.
      maxSize: settings.format === 'tiff' ? undefined : (settings.maxLongEdge ?? undefined),
      colorSpace: space,
      ...(size && base && (own || size.width !== base.width || size.height !== base.height) ? { size } : {}),
      ...(settings.format === 'png' ? { pngDepth: extras.pngDepth } : {}),
      ...tiles(sized),
    });
    checkSignal(signal);
    return blob;
  };

  const renderPreviewsOne = async (asset: Asset, version: Version, signal: AbortSignal): Promise<RenderedPreviews> => {
    // Previews are at most the screen size, which the working image always covers.
    const e = await loaded(asset, signal, 'working');
    e.setRecipe(version.recipe);
    const thumb = await e.renderPreview(THUMB_LONG_EDGE);
    checkSignal(signal);
    const screen = await e.renderPreview(SCREEN_LONG_EDGE);
    checkSignal(signal);
    return { thumb, screen };
  };

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    pending++;
    const job = queue.then(work);
    queue = job.catch(() => undefined).then(() => {
      pending--;
      if (!isDisposed && pending === 0) idleTimer = setTimeout(release, idleMs);
    });
    return job;
  };

  return {
    render(asset, version, settings, signal) {
      return enqueue(() => renderOne(asset, version, settings, signal));
    },
    renderPreviews(asset, version, signal) {
      return enqueue(() => renderPreviewsOne(asset, version, signal));
    },
    dispose() {
      isDisposed = true;
      release();
    },
  };
}
