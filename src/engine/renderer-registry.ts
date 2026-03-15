import type { RenderDriver } from './renderer';
import { Canvas2DRenderer } from './canvas2d-renderer';
import { CanvasKitRenderer } from './canvaskit-renderer';
import { loadCanvasKit } from './canvaskit-loader';
import { GpuSurfacePool } from './gpu-surface-pool';
import { GpuCompositor } from './gpu-compositor';
import { RenderScheduler } from './render-scheduler';
import type { CanvasKit, Surface, GrDirectContext } from 'canvaskit-wasm';

let activeDriver: RenderDriver = new Canvas2DRenderer();
let initPromise: Promise<RenderDriver> | null = null;

// GPU pipeline singletons — only created when CanvasKit is active
let canvasKitInstance: CanvasKit | null = null;
let gpuCanvas: HTMLCanvasElement | null = null;
let grContext: GrDirectContext | null = null;
let screenSurface: Surface | null = null;
let surfacePool: GpuSurfacePool | null = null;
let compositor: GpuCompositor | null = null;
let scheduler: RenderScheduler | null = null;

/**
 * Initialise the rendering driver.  Tries to load CanvasKit (Skia WASM)
 * in the background; if it succeeds the active driver is swapped to the
 * GPU renderer.  If it fails the Canvas 2D driver remains active.
 *
 * Always resolves — never throws.
 */
export async function initRenderer(
  onProgress?: (fraction: number) => void,
): Promise<RenderDriver> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const ck = await loadCanvasKit(onProgress);
    if (ck) {
      try {
        canvasKitInstance = ck as CanvasKit;
        const renderer = new CanvasKitRenderer(canvasKitInstance);
        const testCanvas = renderer.ensureSurface(1, 1);
        if (testCanvas) {
          activeDriver.dispose();
          activeDriver = renderer;
        } else {
          console.warn('[Lopsy] CanvasKit loaded but MakeSurface returned null — falling back to CPU');
          renderer.dispose();
          canvasKitInstance = null;
        }
      } catch (err) {
        console.warn('[Lopsy] CanvasKit renderer creation failed — falling back to CPU', err);
        canvasKitInstance = null;
      }
    } else {
      console.warn('[Lopsy] CanvasKit WASM failed to load — using CPU renderer');
    }
    return activeDriver;
  })();

  return initPromise;
}

/**
 * Create the GPU rendering pipeline bound to an HTMLCanvasElement.
 * Returns the RenderScheduler, or null if CanvasKit is not available.
 *
 * Must be called on the main thread (WebGL contexts can't transfer to workers).
 */
export function createGpuPipeline(canvas: HTMLCanvasElement): RenderScheduler | null {
  if (!canvasKitInstance) return null;
  // Reuse existing pipeline on React StrictMode remount
  if (scheduler && screenSurface && gpuCanvas === canvas) return scheduler;

  const ck = canvasKitInstance;

  try {
    gpuCanvas = canvas;
    const colorSpace = ck.ColorSpace.DISPLAY_P3 ?? ck.ColorSpace.SRGB;

    // Create WebGL context + GrDirectContext (reuse if surviving from previous mount)
    if (!grContext) {
      const glHandle = ck.GetWebGLContext(canvas);
      if (!glHandle) {
        console.warn('[Lopsy] GetWebGLContext returned null — falling back to CPU');
        gpuCanvas = null;
        return null;
      }
      const ctx = ck.MakeWebGLContext(glHandle);
      if (!ctx) {
        console.warn('[Lopsy] MakeWebGLContext returned null — falling back to CPU');
        gpuCanvas = null;
        return null;
      }
      grContext = ctx;
    }

    const w = canvas.width || 1;
    const h = canvas.height || 1;
    const surface = ck.MakeOnScreenGLSurface(grContext, w, h, colorSpace);
    if (!surface) {
      console.warn('[Lopsy] MakeOnScreenGLSurface returned null — falling back to CPU');
      gpuCanvas = null;
      return null;
    }

    // Health check: render a known color, flush, read back from canvas
    if (!verifyGpuRendering(ck, surface, canvas)) {
      console.warn('[Lopsy] GPU rendering health check failed — falling back to CPU');
      surface.dispose();
      gpuCanvas = null;
      return null;
    }

    screenSurface = surface;
    surfacePool = new GpuSurfacePool(ck, screenSurface);
    compositor = new GpuCompositor(ck, screenSurface);
    scheduler = new RenderScheduler(compositor);

    return scheduler;
  } catch (err) {
    console.warn('[Lopsy] GPU pipeline creation failed:', err);
    gpuCanvas = null;
    return null;
  }
}

/**
 * Verify GPU rendering by drawing a known color, flushing, and reading
 * back from the canvas. Returns false if pixels don't match — the GPU
 * surface isn't connected to the canvas and rendering would be invisible.
 */
function verifyGpuRendering(ck: CanvasKit, surface: Surface, canvas: HTMLCanvasElement): boolean {
  try {
    const c = surface.getCanvas();
    // Draw bright magenta — easy to detect
    c.clear(ck.Color4f(1, 0, 1, 1));
    surface.flush();

    // Read back from the canvas via a temporary 2D canvas
    const tmp = document.createElement('canvas');
    tmp.width = Math.min(canvas.width, 4);
    tmp.height = Math.min(canvas.height, 4);
    const ctx = tmp.getContext('2d');
    if (!ctx) return true; // can't verify, assume OK
    ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;

    // Magenta = R:255, G:0, B:255. Allow for color space conversion (P3 → sRGB).
    const ok = pixel[0]! > 180 && pixel[1]! < 80 && pixel[2]! > 180;
    if (!ok) {
      console.warn(`[Lopsy] GPU health check pixel: rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3]}) — expected magenta`);
    }

    // Clear the test frame
    c.clear(ck.Color4f(0, 0, 0, 0));
    surface.flush();

    return ok;
  } catch (err) {
    console.warn('[Lopsy] GPU health check error:', err);
    return true; // can't verify, assume OK
  }
}

/**
 * Resize the GPU screen surface to match new canvas dimensions.
 *
 * Sets the canvas element's width/height attributes (resizing the WebGL
 * drawing buffer), then recreates the screen surface via MakeWebGLCanvasSurface.
 * Layer surfaces remain valid — they use independent FBOs.
 */
export function resizeGpuPipeline(width: number, height: number): void {
  if (!canvasKitInstance || !gpuCanvas || !grContext || !compositor) return;

  const ck = canvasKitInstance;
  const colorSpace = ck.ColorSpace.DISPLAY_P3 ?? ck.ColorSpace.SRGB;

  // Dispose old screen surface before resizing the drawing buffer
  if (screenSurface) {
    screenSurface.flush();
    screenSurface.dispose();
    screenSurface = null;
  }

  // Resize the canvas drawing buffer
  gpuCanvas.width = width;
  gpuCanvas.height = height;

  // Recreate screen surface on the same GrDirectContext
  const surface = ck.MakeOnScreenGLSurface(grContext, width, height, colorSpace);
  if (!surface) {
    console.warn('[Lopsy] Failed to recreate screen surface on resize');
    return;
  }

  screenSurface = surface;

  // Update compositor and pool references
  compositor.updateScreenSurface(screenSurface);
  if (surfacePool) {
    surfacePool.updateScreenSurface(screenSurface);
  }
}

/** Tear down the GPU pipeline (e.g. on unmount). */
export function destroyGpuPipeline(): void {
  if (scheduler) {
    scheduler.dispose();
    scheduler = null;
  }
  if (compositor) {
    compositor.dispose();
    compositor = null;
  }
  if (surfacePool) {
    surfacePool.disposeAll();
    surfacePool = null;
  }
  if (screenSurface) {
    screenSurface.dispose();
    screenSurface = null;
  }
  // Keep gpuCanvas ref — the WebGL context persists on the element
  // and MakeWebGLCanvasSurface will reuse it on remount.
}

/** Synchronous access to the current render driver. */
export function getRenderer(): RenderDriver {
  return activeDriver;
}

/** Get the CanvasKit renderer if active, null otherwise. */
export function getCanvasKitRenderer(): CanvasKitRenderer | null {
  if (activeDriver.type === 'canvaskit') {
    return activeDriver as CanvasKitRenderer;
  }
  return null;
}

/** Whether the active driver is GPU-accelerated. */
export function isGPUAccelerated(): boolean {
  return activeDriver.type === 'canvaskit';
}

/** Get the GPU surface pool (null if GPU not active). */
export function getGpuSurfacePool(): GpuSurfacePool | null {
  return surfacePool;
}

/** Get the GPU compositor (null if GPU not active). */
export function getGpuCompositor(): GpuCompositor | null {
  return compositor;
}

/** Get the render scheduler (null if GPU not active). */
export function getRenderScheduler(): RenderScheduler | null {
  return scheduler;
}

/** Get the raw CanvasKit instance (null if not loaded). */
export function getCanvasKit(): CanvasKit | null {
  return canvasKitInstance;
}
