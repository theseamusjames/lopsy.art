import type { BlendMode } from '../types/index';
import type { RenderDriver } from './renderer';

const SUPPORTED_BLEND_MODES: ReadonlySet<string> = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'difference',
]);

/**
 * Canvas 2D render driver — wraps the existing software rendering path.
 *
 * This driver delegates to the current Canvas 2D code in compositing.ts,
 * blend.ts, canvas-pool.ts, and effects-renderer.ts.  It exists so the
 * rest of the engine can query capabilities uniformly regardless of which
 * renderer is active.
 */
export class Canvas2DRenderer implements RenderDriver {
  readonly type = 'canvas2d' as const;

  supportsBlendMode(mode: BlendMode): boolean {
    return SUPPORTED_BLEND_MODES.has(mode);
  }

  dispose(): void {
    // Nothing to clean up — Canvas 2D resources are managed by the pool.
  }
}
