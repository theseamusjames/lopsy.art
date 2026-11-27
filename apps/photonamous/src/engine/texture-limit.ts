/**
 * The largest texture side this page's GPU allows, for the Export dialog,
 * which may open before any engine has started. An engine's own answer
 * (`maxTextureSize`, recorded by develop-engine.ts as each engine starts)
 * is the truth; before one, on the wgpu build the WebGPU adapter's limit,
 * which that engine asks its device for, and on WebGL `MAX_TEXTURE_SIZE`
 * from a context made for the question. A development build's
 * `?texture-limit=` lowers each.
 */

import { webGpuTextureLimit } from '@lopsy/engine-wasm/renderer-choice';
import { runningRenderer } from './renderer-choice';
import { effectiveTextureLimit } from './develop-override';

let engineLimit: number | null = null;
let probedWebgl: number | null | undefined;

/** An engine started on a GPU whose largest texture side is `limit`. */
export function noteTextureLimit(limit: number): void {
  if (Number.isFinite(limit) && limit > 0) engineLimit = limit;
}

function probeWebgl(): number | null {
  if (probedWebgl !== undefined) return probedWebgl;
  probedWebgl = null;
  if (typeof document === 'undefined') return probedWebgl;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const value: unknown = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof value === 'number' && value > 0) probedWebgl = value;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // No WebGL2: the limit stays unknown.
  }
  return probedWebgl;
}

/** The largest texture side, or null when nothing can tell. */
export function textureLimit(): number | null {
  if (engineLimit !== null) return engineLimit;
  const probed = runningRenderer() === 'wgpu' ? webGpuTextureLimit() : probeWebgl();
  // A development build's `?texture-limit=` (develop-override.ts), as every engine takes it.
  return probed === null ? null : effectiveTextureLimit(probed);
}
