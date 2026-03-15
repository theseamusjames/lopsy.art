import type { BlendMode } from '../types/index';
import type { Layer } from '../types/layers';

/**
 * Opaque handle to a rendering surface.  The Canvas 2D renderer wraps an
 * HTMLCanvasElement; a GPU renderer wraps a GPU texture / surface.
 * Consumers never reach into the underlying implementation.
 */
export interface RenderSurface {
  readonly width: number;
  readonly height: number;
  readonly id: string;
}

/** Lightweight descriptor passed into compositeLayers. */
export interface LayerRenderInfo {
  readonly layer: Layer;
  readonly pixelData: ImageData;
}

/** Context provided to the renderer on each frame. */
export interface RenderFrameContext {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly docWidth: number;
  readonly docHeight: number;
}

/**
 * Abstraction over the rendering implementation.  The engine can swap
 * between Canvas 2D and CanvasKit (Skia WASM) without any changes to
 * consumers.
 */
export interface RenderDriver {
  readonly type: 'canvas2d' | 'canvaskit';

  /** Whether this driver supports a given blend mode natively. */
  supportsBlendMode(mode: BlendMode): boolean;

  /** Dispose GPU resources, workers, etc. */
  dispose(): void;
}
