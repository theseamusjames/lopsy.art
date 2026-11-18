/**
 * The export renderer (photos-core export/types.ts) on the engine: its own
 * DevelopEngine on a canvas that is never shown, so exports run without the
 * Edit view. The engine is kept between items (and a photo loaded twice in
 * a row is decoded once) and released after a short idle.
 */

import type { ExportRenderer, ExportSettings } from '@lopsy/photos-core/export/types';
import type { Asset, Version } from '@lopsy/photos-core/library/types';
import type { DevelopEngine } from './develop-engine';

export interface EngineExportRendererOptions {
  readonly loadOriginal: (asset: Asset, signal: AbortSignal) => Promise<Blob>;
  /** How long the engine is kept after the last render; 20 s by default. */
  readonly idleMs?: number;
  /** Test seam; the real engine by default. */
  readonly createEngine?: (canvas: HTMLCanvasElement) => Promise<DevelopEngine>;
}

export class ExportAbortedError extends Error {
  constructor() {
    super('The export was cancelled');
    this.name = 'AbortError';
  }
}

const DEFAULT_IDLE_MS = 20_000;

/** The engine module (and its wasm) loads with the first export, not with the app. */
function createRealEngine(canvas: HTMLCanvasElement): Promise<DevelopEngine> {
  return import('./develop-engine').then((m) => m.createDevelopEngine(canvas));
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportAbortedError();
}

export function createEngineExportRenderer(options: EngineExportRendererOptions): ExportRenderer & { dispose(): void } {
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
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      engine = create(canvas);
      engine.catch(() => {
        engine = null;
      });
    }
    return engine;
  };

  const renderOne = async (asset: Asset, version: Version, settings: ExportSettings, signal: AbortSignal): Promise<Blob> => {
    checkSignal(signal);
    if (isDisposed) throw new Error('The export renderer was disposed');
    const e = await getEngine();
    checkSignal(signal);
    if (loadedAssetId !== asset.id) {
      loadedAssetId = null;
      const original = await options.loadOriginal(asset, signal);
      checkSignal(signal);
      // A small export can come from the working image; anything larger needs the full size.
      const isSmall = settings.maxLongEdge !== null && settings.maxLongEdge <= 2048;
      await e.load(original, asset.format, undefined, { resolution: isSmall ? 'working' : 'full' });
      loadedAssetId = asset.id;
      checkSignal(signal);
    }
    e.setRecipe(version.recipe);
    if (settings.format === 'tiff') throw new Error('16-bit TIFF export needs the engine’s exportTiff16, not wired yet.');
    const blob = await e.exportImage({
      format: settings.format,
      quality: settings.quality,
      maxSize: settings.maxLongEdge ?? undefined,
    });
    checkSignal(signal);
    return blob;
  };

  return {
    render(asset, version, settings, signal) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      pending++;
      const job = queue.then(() => renderOne(asset, version, settings, signal));
      queue = job.catch(() => undefined).then(() => {
        pending--;
        if (!isDisposed && pending === 0) idleTimer = setTimeout(release, idleMs);
      });
      return job;
    },
    dispose() {
      isDisposed = true;
      release();
    },
  };
}
