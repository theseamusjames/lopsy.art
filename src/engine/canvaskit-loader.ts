/**
 * Lazy-loads the CanvasKit (Skia WASM) binary.
 *
 * The ~7 MB WASM binary is never in the critical rendering path — the app
 * starts with the Canvas 2D renderer and upgrades to CanvasKit after load.
 * If loading fails (no WASM support, network error, WebGL unavailable)
 * the caller falls back to Canvas 2D permanently.
 */

export type CanvasKitModule = unknown;

let cached: CanvasKitModule | null = null;
let loading: Promise<CanvasKitModule | null> | null = null;

export async function loadCanvasKit(
  _onProgress?: (fraction: number) => void,
): Promise<CanvasKitModule | null> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    try {
      const ck = await import('canvaskit-wasm');
      // canvaskit-wasm is CJS; Vite wraps it in an ESM namespace.
      // The init function may be at ck.default, ck.default.default, or ck itself.
      let init: unknown = ck.default;
      if (typeof init !== 'function' && init && typeof (init as Record<string, unknown>).default === 'function') {
        init = (init as Record<string, unknown>).default;
      }
      if (typeof init !== 'function') {
        init = ck;
      }
      if (typeof init !== 'function') {
        console.warn('[Lopsy] canvaskit-wasm module is not a function:', typeof init, Object.keys(ck));
        return null;
      }
      const instance = await (init as unknown as (opts: { locateFile: (file: string) => string }) => Promise<CanvasKitModule>)({
        locateFile: (file: string) => `/assets/${file}`,
      });
      cached = instance;
      return instance;
    } catch (err) {
      console.warn('[Lopsy] CanvasKit WASM load error:', err);
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export function getCanvasKit(): CanvasKitModule | null {
  return cached;
}
