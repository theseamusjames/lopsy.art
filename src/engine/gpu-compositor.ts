/**
 * GPU-native compositor.
 *
 * Owns the screen SkSurface bound to the HTMLCanvasElement via
 * MakeWebGLCanvasSurface. Composites layer snapshots directly on
 * the GPU — no readPixels in the hot path.
 */

import type {
  CanvasKit, Surface, Canvas, Paint, Image as CKImage,
  ColorSpace, ImageFilter, ColorFilter,
} from 'canvaskit-wasm';
import type { BlendMode } from '../types/index';
import type { Layer } from '../types/layers';
import type { LayerEffects } from '../types/effects';
import type { GpuSurfacePool } from './gpu-surface-pool';
import type { SelectionData } from '../app/rendering/render-selection';

/** Map our BlendMode names to CanvasKit's enum values. */
function getBlendMode(ck: CanvasKit, mode: BlendMode): unknown {
  const map: Record<BlendMode, unknown> = {
    'normal': ck.BlendMode.SrcOver,
    'multiply': ck.BlendMode.Multiply,
    'screen': ck.BlendMode.Screen,
    'overlay': ck.BlendMode.Overlay,
    'darken': ck.BlendMode.Darken,
    'lighten': ck.BlendMode.Lighten,
    'color-dodge': ck.BlendMode.ColorDodge,
    'color-burn': ck.BlendMode.ColorBurn,
    'hard-light': ck.BlendMode.HardLight,
    'soft-light': ck.BlendMode.SoftLight,
    'difference': ck.BlendMode.Difference,
    'exclusion': ck.BlendMode.Exclusion,
    'hue': ck.BlendMode.Hue,
    'saturation': ck.BlendMode.Saturation,
    'color': ck.BlendMode.Color,
    'luminosity': ck.BlendMode.Luminosity,
  };
  return map[mode];
}

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface CompositeFrameInput {
  readonly viewport: Viewport;
  readonly docWidth: number;
  readonly docHeight: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly layers: readonly Layer[];
  readonly pixelData: Map<string, ImageData>;
  readonly pool: GpuSurfacePool;
  readonly maskEditMode: boolean;
  readonly activeLayerId: string;
}

export class GpuCompositor {
  private ck: CanvasKit;
  private screenSurface: Surface;
  private paint: Paint;
  private effectPaint: Paint;
  private colorSpace: ColorSpace;

  // Checkerboard cached as an SkImage tile
  private checkerImage: CKImage | null = null;

  // Cached SkImages from CPU pixel data — avoids re-upload every frame
  // Tracks both version (bumped on explicit updates) and data reference (catches undo/redo)
  private imageCache = new Map<string, { image: CKImage; version: number; dataRef: ImageData }>();
  private pixelVersions = new Map<string, number>();

  constructor(ck: CanvasKit, screenSurface: Surface) {
    this.ck = ck;
    this.screenSurface = screenSurface;
    this.paint = new ck.Paint();
    this.effectPaint = new ck.Paint();
    this.colorSpace = ck.ColorSpace.DISPLAY_P3 ?? ck.ColorSpace.SRGB;
    this.buildCheckerImage();
  }

  get surface(): Surface {
    return this.screenSurface;
  }

  /**
   * Update the screen surface reference (called on resize).
   * Rebuilds the checkerboard image on the new surface.
   */
  updateScreenSurface(newScreenSurface: Surface): void {
    if (this.checkerImage) {
      this.checkerImage.delete();
      this.checkerImage = null;
    }
    this.screenSurface = newScreenSurface;
    this.buildCheckerImage();
  }

  private buildCheckerImage(): void {
    const ck = this.ck;
    const tileInfo = {
      width: 16,
      height: 16,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Opaque,
      colorSpace: this.colorSpace,
    };
    let tileSurface: import('canvaskit-wasm').Surface | null;
    try { tileSurface = this.screenSurface.makeSurface(tileInfo); } catch { tileSurface = null; }
    if (!tileSurface) return;
    const tc = tileSurface.getCanvas();
    const white = new ck.Paint();
    white.setColor(ck.Color4f(1, 1, 1, 1));
    tc.drawRect(ck.LTRBRect(0, 0, 16, 16), white);
    const gray = new ck.Paint();
    gray.setColor(ck.Color4f(0.8, 0.8, 0.8, 1));
    tc.drawRect(ck.LTRBRect(8, 0, 16, 8), gray);
    tc.drawRect(ck.LTRBRect(0, 8, 8, 16), gray);
    white.delete();
    gray.delete();
    this.checkerImage = tileSurface.makeImageSnapshot();
    tileSurface.dispose();
  }

  /** Render the full document composite frame to the screen surface. */
  renderComposite(input: CompositeFrameInput): void {
    const ck = this.ck;
    const canvas = this.screenSurface.getCanvas();
    const { viewport, docWidth, docHeight, canvasWidth, canvasHeight } = input;

    // Background
    canvas.clear(ck.Color4f(0.235, 0.235, 0.235, 1)); // #3c3c3c

    if (docWidth === 0 || docHeight === 0) {
      this.screenSurface.flush();
      return;
    }

    // Viewport transform
    canvas.save();
    canvas.translate(viewport.panX + canvasWidth / 2, viewport.panY + canvasHeight / 2);
    canvas.scale(viewport.zoom, viewport.zoom);
    canvas.translate(-docWidth / 2, -docHeight / 2);

    // Checkerboard
    this.drawCheckerboard(canvas, docWidth, docHeight);

    // Composite each visible layer
    for (const layer of input.layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      this.drawLayer(canvas, layer, input);
    }

    // Document border
    const borderPaint = new ck.Paint();
    borderPaint.setStyle(ck.PaintStyle.Stroke);
    borderPaint.setColor(ck.Color4f(0.4, 0.4, 0.4, 1)); // #666666
    borderPaint.setStrokeWidth(1 / viewport.zoom);
    canvas.drawRect(ck.LTRBRect(0, 0, docWidth, docHeight), borderPaint);
    borderPaint.delete();

    canvas.restore();
    this.screenSurface.flush();
  }

  private drawCheckerboard(canvas: Canvas, docWidth: number, docHeight: number): void {
    if (!this.checkerImage) return;
    const ck = this.ck;

    // Clip to document area
    canvas.save();
    canvas.clipRect(ck.LTRBRect(0, 0, docWidth, docHeight), ck.ClipOp.Intersect, false);

    // Tile the checker image using a shader
    const shader = this.checkerImage.makeShaderOptions(
      ck.TileMode.Repeat,
      ck.TileMode.Repeat,
      ck.FilterMode.Nearest,
      ck.MipmapMode.None,
    );
    const checkerPaint = new ck.Paint();
    checkerPaint.setShader(shader);
    canvas.drawRect(ck.LTRBRect(0, 0, docWidth, docHeight), checkerPaint);
    checkerPaint.delete();
    shader.delete();

    canvas.restore();
  }

  private drawLayer(canvas: Canvas, layer: Layer, input: CompositeFrameInput): void {
    const ck = this.ck;
    const { pixelData } = input;

    // Get or create SkImage from CPU pixel data
    const layerImg = this.getLayerImage(layer.id, pixelData);
    if (!layerImg) return;

    this.paint.setAlphaf(layer.opacity);
    this.paint.setBlendMode(getBlendMode(ck, layer.blendMode) as never);

    // Build effect filters
    const filters = this.buildEffectFilters(layer.effects);
    if (filters.length > 0) {
      this.drawWithEffects(canvas, layerImg, layer, filters);
    } else {
      canvas.drawImage(layerImg, layer.x, layer.y, this.paint);
    }

    for (const f of filters) f.delete();
  }

  /**
   * Get a cached SkImage for a layer, creating/updating from CPU pixel data
   * only when the data has changed.
   */
  private getLayerImage(layerId: string, pixelData: Map<string, ImageData>): CKImage | null {
    const data = pixelData.get(layerId);
    if (!data) return null;

    const ck = this.ck;
    const currentVersion = this.pixelVersions.get(layerId) ?? 0;
    const cached = this.imageCache.get(layerId);

    // Cache hit: version matches (no explicit update) AND same ImageData reference (no undo/redo)
    if (cached && cached.version === currentVersion && cached.dataRef === data) {
      return cached.image;
    }

    // Dispose old cached image
    if (cached) cached.image.delete();

    // Pixel data from canvas 2D APIs is always sRGB — tag it correctly.
    // CanvasKit handles sRGB→P3 conversion when drawing to the P3 screen surface.
    const imgInfo = {
      width: data.width,
      height: data.height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    };
    const img = ck.MakeImage(imgInfo, data.data, data.width * 4);
    if (!img) return null;

    this.imageCache.set(layerId, { image: img, version: currentVersion, dataRef: data });
    return img;
  }

  /** Mark a layer's cached image as stale (call when pixel data changes). */
  bumpPixelVersion(layerId: string): void {
    this.pixelVersions.set(layerId, (this.pixelVersions.get(layerId) ?? 0) + 1);
  }

  private buildEffectFilters(effects: LayerEffects): ImageFilter[] {
    const ck = this.ck;
    const filters: ImageFilter[] = [];

    if (effects.dropShadow.enabled) {
      const s = effects.dropShadow;
      const sigma = s.blur / 2;
      const color = ck.Color4f(s.color.r / 255, s.color.g / 255, s.color.b / 255, s.color.a);
      filters.push(ck.ImageFilter.MakeDropShadowOnly(
        s.offsetX, s.offsetY, sigma, sigma, color, null,
      ));
    }

    if (effects.outerGlow.enabled) {
      const g = effects.outerGlow;
      const sigma = (g.size + g.spread) / 2;
      const color = ck.Color4f(g.color.r / 255, g.color.g / 255, g.color.b / 255, g.opacity);
      const blur = ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Clamp, null);
      const cf = ck.ColorFilter.MakeBlend(color, ck.BlendMode.SrcIn as never);
      const colorized = ck.ImageFilter.MakeColorFilter(cf, blur);
      cf.delete();
      blur.delete();
      filters.push(colorized);
    }

    if (effects.innerGlow.enabled) {
      const g = effects.innerGlow;
      const sigma = (g.size + g.spread) / 2;
      const radius = Math.max(1, Math.round(sigma));
      const color = ck.Color4f(g.color.r / 255, g.color.g / 255, g.color.b / 255, g.opacity);
      const erode = ck.ImageFilter.MakeErode(radius, radius, null);
      const cf = ck.ColorFilter.MakeBlend(color, ck.BlendMode.SrcIn as never);
      const colorized = ck.ImageFilter.MakeColorFilter(cf, erode);
      cf.delete();
      erode.delete();
      filters.push(colorized);
    }

    return filters;
  }

  private drawWithEffects(
    canvas: Canvas,
    img: CKImage,
    layer: Layer,
    filters: ImageFilter[],
  ): void {
    const ck = this.ck;
    const effects = layer.effects;

    let colorFilter: ColorFilter | null = null;
    if (effects.colorOverlay.enabled) {
      const c = effects.colorOverlay.color;
      const color = ck.Color4f(c.r / 255, c.g / 255, c.b / 255, c.a);
      colorFilter = ck.ColorFilter.MakeBlend(color, ck.BlendMode.SrcATop as never);
    }

    let filterIdx = 0;
    if (effects.dropShadow.enabled && filterIdx < filters.length) {
      this.effectPaint.setAlphaf(layer.opacity);
      this.effectPaint.setBlendMode(getBlendMode(ck, layer.blendMode) as never);
      this.effectPaint.setImageFilter(filters[filterIdx]!);
      canvas.drawImage(img, layer.x, layer.y, this.effectPaint);
      this.effectPaint.setImageFilter(null);
      filterIdx++;
    }

    if (effects.outerGlow.enabled && filterIdx < filters.length) {
      this.effectPaint.setAlphaf(layer.opacity);
      this.effectPaint.setBlendMode(getBlendMode(ck, layer.blendMode) as never);
      this.effectPaint.setImageFilter(filters[filterIdx]!);
      canvas.drawImage(img, layer.x, layer.y, this.effectPaint);
      this.effectPaint.setImageFilter(null);
      filterIdx++;
    }

    if (colorFilter) {
      this.paint.setColorFilter(colorFilter);
    }
    canvas.drawImage(img, layer.x, layer.y, this.paint);
    if (colorFilter) {
      this.paint.setColorFilter(null);
      colorFilter.delete();
    }

    if (effects.innerGlow.enabled && filterIdx < filters.length) {
      this.effectPaint.setAlphaf(layer.opacity);
      this.effectPaint.setBlendMode(ck.BlendMode.SrcOver as never);
      this.effectPaint.setImageFilter(filters[filterIdx]!);
      canvas.drawImage(img, layer.x, layer.y, this.effectPaint);
      this.effectPaint.setImageFilter(null);
      filterIdx++;
    }
  }

  /** Render overlays (selection ants, handles, etc.) via CanvasKit draw calls. */
  renderOverlays(
    viewport: Viewport,
    docWidth: number,
    docHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    selection: SelectionData,
    antPhase: number,
  ): void {
    // For Phase 1, overlays are still drawn on a separate Canvas 2D overlay.
    // This method is a placeholder for Phase 2+ when overlays move to CanvasKit.
    void viewport;
    void docWidth;
    void docHeight;
    void canvasWidth;
    void canvasHeight;
    void selection;
    void antPhase;
  }

  dispose(): void {
    this.paint.delete();
    this.effectPaint.delete();
    if (this.checkerImage) {
      this.checkerImage.delete();
      this.checkerImage = null;
    }
    for (const entry of this.imageCache.values()) {
      entry.image.delete();
    }
    this.imageCache.clear();
    // Screen surface is owned externally (by renderer-registry)
  }
}
