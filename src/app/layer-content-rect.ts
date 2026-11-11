import type { Rect } from '../types';
import type { Engine } from '../engine-wasm/wasm-bridge';
import {
  getLayerContentBounds,
  getLayerEngineBounds,
  layerContentGeneration,
} from '../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../engine/pixel-data-manager';

interface CachedBounds {
  key: string;
  /** Texture-local. */
  rect: Rect | null;
}

const cache = new Map<string, CachedBounds>();
/** The engine the cache describes; a new engine restarts content generations. */
let cachedEngine: Engine | null = null;

/**
 * Document-space content rect of a layer's GPU texture, or null when it is
 * empty. Read on the GPU (`width + height` texels) and cached, texture-local,
 * until the layer's content generation, JS pixel version or texture size
 * changes — so moving a layer, or a history step that leaves its pixels alone
 * (visibility, opacity, rename), reads nothing back (#1293). Every texture
 * writer, undo/redo restore included, bumps the content generation.
 */
export function layerContentRect(engine: Engine, layerId: string): Rect | null {
  if (engine !== cachedEngine) {
    cache.clear();
    cachedEngine = engine;
  }
  const [x = 0, y = 0, w = 0, h = 0] = getLayerEngineBounds(engine, layerId);
  const key = [
    layerContentGeneration(engine, layerId),
    pixelDataManager.versionOf(layerId),
    w,
    h,
  ].join('|');
  let cached = cache.get(layerId);
  if (!cached || cached.key !== key) {
    const local = getLayerContentBounds(engine, layerId);
    const lw = local[2] ?? 0;
    const lh = local[3] ?? 0;
    const rect = lw > 0 && lh > 0 ? { x: local[0] ?? 0, y: local[1] ?? 0, width: lw, height: lh } : null;
    cached = { key, rect };
    cache.set(layerId, cached);
  }
  return cached.rect ? { ...cached.rect, x: cached.rect.x + x, y: cached.rect.y + y } : null;
}

/** Drop every cached rect (engine replaced, or a test reset). */
export function clearLayerContentRectCache(): void {
  cache.clear();
  cachedEngine = null;
}
