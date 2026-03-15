import type { BlendMode } from '../types/index';
import type { LayerEffects, LayerMask } from '../types/effects';
import type { RenderDriver } from './renderer';
import type {
  CanvasKit, Surface, Canvas, Paint, Image as CKImage,
  ColorSpace, ImageFilter, ColorFilter,
} from 'canvaskit-wasm';

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

export interface LayerCompositeInfo {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly visible: boolean;
  readonly pixelData: Uint8ClampedArray;
  readonly effects: LayerEffects;
  readonly mask: LayerMask | null;
}

/**
 * CanvasKit (Skia WASM) render driver.
 *
 * Handles layer compositing on an offscreen Skia surface with GPU-backed
 * blend modes, color management, and Skia image filters for effects.
 * Overlay rendering (selection ants, grid, cursors) stays on Canvas 2D.
 */
export class CanvasKitRenderer implements RenderDriver {
  readonly type = 'canvaskit' as const;
  private ck: CanvasKit;
  private surface: Surface | null = null;
  private paint: Paint;
  private effectPaint: Paint;
  private colorSpace: ColorSpace;
  private imageCache = new Map<string, { image: CKImage; version: number }>();

  constructor(ck: CanvasKit) {
    this.ck = ck;
    this.paint = new ck.Paint();
    this.effectPaint = new ck.Paint();
    this.colorSpace = ck.ColorSpace.DISPLAY_P3 ?? ck.ColorSpace.SRGB;
  }

  /** All 16 blend modes are natively supported by Skia. */
  supportsBlendMode(_mode: BlendMode): boolean {
    return true;
  }

  /**
   * Ensure the offscreen surface matches the required dimensions.
   * Returns the Skia Canvas for drawing.
   */
  ensureSurface(width: number, height: number): Canvas | null {
    if (this.surface) {
      const info = this.surface.imageInfo();
      if (info.width === width && info.height === height) {
        return this.surface.getCanvas();
      }
      this.surface.dispose();
      this.surface = null;
    }

    this.surface = this.ck.MakeSurface(width, height) ?? null;
    return this.surface?.getCanvas() ?? null;
  }

  /**
   * Composite the given layers onto the offscreen surface and return
   * an ImageData that can be drawn to the screen canvas.
   */
  compositeLayers(
    docWidth: number,
    docHeight: number,
    layers: readonly LayerCompositeInfo[],
  ): ImageData | null {
    const canvas = this.ensureSurface(docWidth, docHeight);
    if (!canvas) return null;

    canvas.clear(this.ck.Color4f(0, 0, 0, 0));

    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue;

      const img = this.makeImage(layer);
      if (!img) continue;

      // Apply mask if present
      const maskedImg = layer.mask?.enabled
        ? this.applyMask(img, layer.mask, layer.width, layer.height)
        : null;
      const drawImg = maskedImg ?? img;

      this.paint.setAlphaf(layer.opacity);
      this.paint.setBlendMode(getBlendMode(this.ck, layer.blendMode) as never);

      // Build effect filters and draw
      const filters = this.buildEffectFilters(layer, drawImg);
      if (filters.length > 0) {
        this.drawWithEffects(canvas, drawImg, layer, filters);
      } else {
        canvas.drawImage(drawImg, layer.x, layer.y, this.paint);
      }

      // Clean up per-frame images
      if (maskedImg) maskedImg.delete();
      img.delete();
      for (const f of filters) f.delete();
    }

    this.surface!.flush();

    const pixels = canvas.readPixels(0, 0, {
      width: docWidth,
      height: docHeight,
      colorType: this.ck.ColorType.RGBA_8888,
      alphaType: this.ck.AlphaType.Unpremul,
      colorSpace: this.colorSpace,
    });

    if (!pixels) return null;
    const buf = pixels.buffer.slice(0) as ArrayBuffer;
    return new ImageData(new Uint8ClampedArray(buf), docWidth, docHeight);
  }

  /** Create a CanvasKit Image from layer pixel data. */
  private makeImage(layer: LayerCompositeInfo): CKImage | null {
    const info = {
      width: layer.width,
      height: layer.height,
      colorType: this.ck.ColorType.RGBA_8888,
      alphaType: this.ck.AlphaType.Unpremul,
      colorSpace: this.colorSpace,
    };
    return this.ck.MakeImage(info, layer.pixelData, layer.width * 4);
  }

  /** Apply a layer mask by compositing via an offscreen surface. */
  private applyMask(
    img: CKImage,
    mask: LayerMask,
    width: number,
    height: number,
  ): CKImage | null {
    const ck = this.ck;
    const surf = ck.MakeSurface(width, height);
    if (!surf) return null;

    const c = surf.getCanvas();

    // Draw the layer content
    c.drawImage(img, 0, 0);

    // Build mask as a grayscale RGBA image
    const maskRGBA = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let i = 0; i < mask.data.length; i++) {
      const val = mask.data[i] ?? 0;
      const idx = i * 4;
      maskRGBA[idx] = val;
      maskRGBA[idx + 1] = val;
      maskRGBA[idx + 2] = val;
      maskRGBA[idx + 3] = val;
    }
    const maskImg = ck.MakeImage(
      { width: mask.width, height: mask.height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: this.colorSpace },
      maskRGBA,
      mask.width * 4,
    );
    if (!maskImg) { surf.dispose(); return null; }

    // destination-in: keep layer pixels only where mask is opaque
    const maskPaint = new ck.Paint();
    maskPaint.setBlendMode(ck.BlendMode.DstIn as never);
    c.drawImage(maskImg, 0, 0, maskPaint);
    maskPaint.delete();
    maskImg.delete();

    const result = surf.makeImageSnapshot();
    surf.dispose();
    return result;
  }

  /**
   * Build Skia ImageFilters for the enabled effects on a layer.
   * Returns filters that should be drawn separately (before/after the main image).
   */
  private buildEffectFilters(
    layer: LayerCompositeInfo,
    _img: CKImage,
  ): ImageFilter[] {
    const ck = this.ck;
    const effects = layer.effects;
    const filters: ImageFilter[] = [];

    // Drop shadow — rendered as a separate draw behind the layer
    if (effects.dropShadow.enabled) {
      const s = effects.dropShadow;
      const sigma = s.blur / 2;
      const color = ck.Color4f(s.color.r / 255, s.color.g / 255, s.color.b / 255, s.color.a);
      const filter = ck.ImageFilter.MakeDropShadowOnly(
        s.offsetX, s.offsetY, sigma, sigma, color, null,
      );
      filters.push(filter);
    }

    // Outer glow — blur + colorize, drawn behind the layer
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

    // Inner glow — erode + difference, drawn on top
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

  /**
   * Draw a layer image with its effects filters.
   * Filters are drawn as separate passes (behind/on top of the main image).
   */
  private drawWithEffects(
    canvas: Canvas,
    img: CKImage,
    layer: LayerCompositeInfo,
    filters: ImageFilter[],
  ): void {
    const ck = this.ck;
    const effects = layer.effects;

    // Color overlay: apply via color filter on the main paint
    let colorFilter: ColorFilter | null = null;
    if (effects.colorOverlay.enabled) {
      const c = effects.colorOverlay.color;
      const color = ck.Color4f(c.r / 255, c.g / 255, c.b / 255, c.a);
      colorFilter = ck.ColorFilter.MakeBlend(color, ck.BlendMode.SrcATop as never);
    }

    // Draw effects that go behind the layer (drop shadow, outer glow)
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

    // Draw the main layer content
    if (colorFilter) {
      this.paint.setColorFilter(colorFilter);
    }
    canvas.drawImage(img, layer.x, layer.y, this.paint);
    if (colorFilter) {
      this.paint.setColorFilter(null);
      colorFilter.delete();
    }

    // Draw effects that go on top (inner glow)
    if (effects.innerGlow.enabled && filterIdx < filters.length) {
      this.effectPaint.setAlphaf(layer.opacity);
      this.effectPaint.setBlendMode(ck.BlendMode.SrcOver as never);
      this.effectPaint.setImageFilter(filters[filterIdx]!);
      canvas.drawImage(img, layer.x, layer.y, this.effectPaint);
      this.effectPaint.setImageFilter(null);
      filterIdx++;
    }

    // Stroke still handled by Canvas 2D EDT path (Skia stroke is for vector shapes)
  }

  /** Invalidate a cached image (e.g. when pixel data changes). */
  invalidateLayer(layerId: string): void {
    const entry = this.imageCache.get(layerId);
    if (entry) {
      entry.image.delete();
      this.imageCache.delete(layerId);
    }
  }

  /** Invalidate all cached images. */
  invalidateAll(): void {
    for (const entry of this.imageCache.values()) {
      entry.image.delete();
    }
    this.imageCache.clear();
  }

  dispose(): void {
    this.invalidateAll();
    this.paint.delete();
    this.effectPaint.delete();
    if (this.surface) {
      this.surface.dispose();
      this.surface = null;
    }
  }
}
