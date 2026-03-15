/**
 * Manages persistent GPU-backed SkSurfaces, one per raster layer.
 *
 * All surfaces share the same WebGL context (via the screen surface's
 * GrDirectContext) and use the best available color type (RGBA_F16 for
 * 10-bit+ color, falling back to RGBA_8888 if F16 isn't supported).
 * CPU ↔ GPU transfers only happen at import/export boundaries.
 */

import type {
  CanvasKit, Surface, Image as CKImage, ColorSpace, ImageInfo, ColorType,
} from 'canvaskit-wasm';

export class GpuSurfacePool {
  private ck: CanvasKit;
  private screenSurface: Surface;
  private colorSpace: ColorSpace;
  private colorType: ColorType;
  private pool = new Map<string, Surface>();

  constructor(ck: CanvasKit, screenSurface: Surface) {
    this.ck = ck;
    this.screenSurface = screenSurface;
    this.colorSpace = ck.ColorSpace.DISPLAY_P3 ?? ck.ColorSpace.SRGB;
    // Probe for F16 support — fall back to 8888 if the GPU can't create F16 surfaces
    this.colorType = this.probeColorType();
  }

  private probeColorType(): ColorType {
    const ck = this.ck;
    try {
      const f16Info: ImageInfo = {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_F16,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: this.colorSpace,
      };
      const probe = this.screenSurface.makeSurface(f16Info);
      if (probe) {
        probe.dispose();
        return ck.ColorType.RGBA_F16;
      }
    } catch {
      // makeSurface can throw (not just return null) on unsupported formats
    }
    console.warn('[Lopsy] RGBA_F16 surfaces not supported — using RGBA_8888');
    return ck.ColorType.RGBA_8888;
  }

  private makeInfo(width: number, height: number): ImageInfo {
    return {
      width,
      height,
      colorType: this.colorType,
      alphaType: this.ck.AlphaType.Unpremul,
      colorSpace: this.colorSpace,
    };
  }

  /**
   * Create (or recreate) a GPU surface for the given layer.
   * If a surface already exists for this id it is disposed first.
   * Returns null if GPU surface creation fails.
   */
  create(id: string, width: number, height: number): Surface | null {
    this.dispose(id);
    const info = this.makeInfo(width, height);
    let surface: Surface | null;
    try {
      surface = this.screenSurface.makeSurface(info);
    } catch {
      surface = null;
    }
    if (!surface) {
      console.warn(`[Lopsy] Failed to create GPU surface for layer ${id} (${width}x${height})`);
      return null;
    }
    surface.getCanvas().clear(this.ck.Color4f(0, 0, 0, 0));
    this.pool.set(id, surface);
    return surface;
  }

  /** Get the existing surface for a layer, or null if none. */
  get(id: string): Surface | null {
    return this.pool.get(id) ?? null;
  }

  /** Whether a surface exists for this layer. */
  has(id: string): boolean {
    return this.pool.has(id);
  }

  /**
   * Upload CPU ImageData (8-bit) into a GPU surface.
   * Creates the surface if it doesn't exist.
   * Returns the surface, or null if creation failed.
   */
  uploadFromImageData(id: string, data: ImageData): Surface | null {
    let surface = this.pool.get(id) ?? null;
    const needsResize = surface !== null && (
      surface.width() !== data.width || surface.height() !== data.height
    );
    if (!surface || needsResize) {
      surface = this.create(id, data.width, data.height);
      if (!surface) return null;
    }

    const ck = this.ck;
    const imgInfo: ImageInfo = {
      width: data.width,
      height: data.height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: this.colorSpace,
    };
    const img = ck.MakeImage(imgInfo, data.data, data.width * 4);
    if (img) {
      const canvas = surface.getCanvas();
      canvas.clear(ck.Color4f(0, 0, 0, 0));
      canvas.drawImage(img, 0, 0);
      img.delete();
    }

    return surface;
  }

  /** Take a COW snapshot of a layer surface (near-zero cost). */
  snapshot(id: string): CKImage | null {
    const surface = this.pool.get(id);
    if (!surface) return null;
    return surface.makeImageSnapshot();
  }

  /** Dispose a single layer surface. */
  dispose(id: string): void {
    const surface = this.pool.get(id);
    if (surface) {
      surface.dispose();
      this.pool.delete(id);
    }
  }

  /** Dispose all surfaces. */
  disposeAll(): void {
    for (const surface of this.pool.values()) {
      surface.dispose();
    }
    this.pool.clear();
  }

  /**
   * Update the screen surface reference (called on resize).
   * Existing layer surfaces remain valid — they share the same GrDirectContext.
   */
  updateScreenSurface(newScreenSurface: Surface): void {
    this.screenSurface = newScreenSurface;
  }

  /** Iterate over all layer IDs with surfaces. */
  ids(): IterableIterator<string> {
    return this.pool.keys();
  }
}
