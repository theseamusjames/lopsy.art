import { maxDocumentSide } from '../utils/document-size';
import { runningRenderer, webGpuTextureLimit } from './renderer-choice';

let cachedMaxTextureSize: number | null | undefined;

/**
 * The largest texture side the GPU allows. The New Document dialog runs
 * before the engine exists, so this can't ask the engine.
 *
 * On a page that runs the wgpu engine it is the WebGPU adapter's limit,
 * which that engine's device is created with and which can be smaller
 * than WebGL's on the same GPU. Otherwise, and until the renderer has
 * been chosen, it is `MAX_TEXTURE_SIZE` probed once from a throwaway
 * WebGL2 context. Returns null where neither is available.
 */
export function getGpuMaxTextureSize(): number | null {
  if (runningRenderer() === 'wgpu') {
    const limit = webGpuTextureLimit();
    if (limit !== null) return limit;
  }
  if (cachedMaxTextureSize !== undefined) return cachedMaxTextureSize;
  cachedMaxTextureSize = null;
  if (typeof document === 'undefined') return cachedMaxTextureSize;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      const value: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (typeof value === 'number' && value > 0) cachedMaxTextureSize = value;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No WebGL2 — leave the limit unknown.
  }
  return cachedMaxTextureSize;
}

/** Largest document side this device can allocate. */
export function getMaxDocumentSide(): number {
  return maxDocumentSide(getGpuMaxTextureSize());
}
