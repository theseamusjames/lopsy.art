import { maxDocumentSide } from '../utils/document-size';

let cachedMaxTextureSize: number | null | undefined;

/**
 * The GPU's `MAX_TEXTURE_SIZE`, probed once from a throwaway WebGL2
 * context. The New Document dialog runs before the engine exists, so this
 * can't ask the engine. Returns null where WebGL2 isn't available.
 */
export function getGpuMaxTextureSize(): number | null {
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
