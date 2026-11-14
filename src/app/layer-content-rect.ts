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

interface PendingRead {
  key: string;
  rect: Promise<Rect | null>;
}

const cache = new Map<string, CachedBounds>();
/** Reads on their way from the GPU, by layer. */
const pending = new Map<string, PendingRead>();
/** The engine the cache describes; a new engine restarts content generations. */
let cachedEngine: Engine | null = null;
let onRefreshed: (() => void) | null = null;

/**
 * Call `listener` when a rect that `layerContentRect` asked for has arrived,
 * so whatever drew the stand-in can draw again.
 */
export function onLayerContentRectRefreshed(listener: () => void): void {
  onRefreshed = listener;
}

function describeLayer(engine: Engine, layerId: string): { key: string; x: number; y: number } {
  if (engine !== cachedEngine) {
    cache.clear();
    pending.clear();
    cachedEngine = engine;
  }
  const [x = 0, y = 0, w = 0, h = 0] = getLayerEngineBounds(engine, layerId);
  const key = [
    layerContentGeneration(engine, layerId),
    pixelDataManager.versionOf(layerId),
    w,
    h,
  ].join('|');
  return { key, x, y };
}

function toRect(local: ArrayLike<number>): Rect | null {
  const width = local[2] ?? 0;
  const height = local[3] ?? 0;
  return width > 0 && height > 0 ? { x: local[0] ?? 0, y: local[1] ?? 0, width, height } : null;
}

/**
 * Read the texture-local content rect for `key` on the GPU (`width + height`
 * texels). Callers asking for the same key while it is out share one read;
 * the answer is cached unless a newer key or a new engine replaced it.
 */
function readLocal(engine: Engine, layerId: string, key: string): Promise<Rect | null> {
  const inFlight = pending.get(layerId);
  if (inFlight && inFlight.key === key) return inFlight.rect;
  const entry: PendingRead = { key, rect: Promise.resolve(null) };
  entry.rect = getLayerContentBounds(engine, layerId)
    .then(toRect, () => null)
    .then((rect) => {
      if (pending.get(layerId) === entry) {
        pending.delete(layerId);
        cache.set(layerId, { key, rect });
      }
      return rect;
    });
  pending.set(layerId, entry);
  return entry.rect;
}

function inDocument(local: Rect | null, x: number, y: number): Rect | null {
  return local ? { ...local, x: local.x + x, y: local.y + y } : null;
}

/**
 * Document-space content rect of a layer's GPU texture, or null when it is
 * empty, for code that draws or hit-tests and cannot wait. The rect is
 * cached, texture-local, until the layer's content generation, JS pixel
 * version or texture size changes — so moving a layer, or a history step
 * that leaves its pixels alone (visibility, opacity, rename), reads nothing
 * back (#1293). Every texture writer, undo/redo restore included, bumps the
 * content generation. When it has changed, the last rect known stands in
 * while the new one is read, and `onLayerContentRectRefreshed` fires when it
 * lands.
 */
export function layerContentRect(engine: Engine, layerId: string): Rect | null {
  const { key, x, y } = describeLayer(engine, layerId);
  const cached = cache.get(layerId);
  if ((!cached || cached.key !== key) && pending.get(layerId)?.key !== key) {
    void readLocal(engine, layerId, key).then(() => onRefreshed?.());
  }
  return inDocument(cached?.rect ?? null, x, y);
}

/**
 * The texture-local content rect as it is now, for an action that moves
 * pixels by it and so must not use a stand-in. Reads only when the cache
 * is out of date.
 */
export async function readLayerContentRectLocal(engine: Engine, layerId: string): Promise<Rect | null> {
  const { key } = describeLayer(engine, layerId);
  const cached = cache.get(layerId);
  return cached && cached.key === key ? cached.rect : readLocal(engine, layerId, key);
}

/**
 * The texture-local content rect if it is known for the pixels the layer
 * holds now: a rect, or null for an empty layer. Undefined when it is not
 * known yet, in which case it is being read and
 * `onLayerContentRectRefreshed` fires when it lands. For a pointer-down
 * that must decide at once and cannot use a stand-in.
 */
export function peekLayerContentRectLocal(engine: Engine, layerId: string): Rect | null | undefined {
  const { key } = describeLayer(engine, layerId);
  const cached = cache.get(layerId);
  if (cached && cached.key === key) return cached.rect;
  if (pending.get(layerId)?.key !== key) {
    void readLocal(engine, layerId, key).then(() => onRefreshed?.());
  }
  return undefined;
}

/**
 * Record that a layer's texture was just cropped to its content, so its
 * content fills the texture and the next ask reads nothing.
 */
export function noteLayerCroppedToContent(engine: Engine, layerId: string, width: number, height: number): void {
  const { key } = describeLayer(engine, layerId);
  pending.delete(layerId);
  cache.set(layerId, { key, rect: { x: 0, y: 0, width, height } });
}

/** `readLayerContentRectLocal` in document space. */
export async function readLayerContentRect(engine: Engine, layerId: string): Promise<Rect | null> {
  const { x, y } = describeLayer(engine, layerId);
  return inDocument(await readLayerContentRectLocal(engine, layerId), x, y);
}

/** Drop every cached rect (engine replaced, or a test reset). */
export function clearLayerContentRectCache(): void {
  cache.clear();
  pending.clear();
  cachedEngine = null;
}
