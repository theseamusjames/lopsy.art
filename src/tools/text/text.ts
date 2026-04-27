import type { Point, PixelSurface, FontStyle, TextAlign } from '../../types';
import { contextOptions } from '../../engine/color-space';

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: FontStyle;
  color: { r: number; g: number; b: number; a: number };
  lineHeight: number;
  letterSpacing: number;
  textAlign: TextAlign;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  fontSize: number;
}

/** Build a CSS font string from style parameters. */
export function buildFontString(style: TextStyle): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

/**
 * Break text into lines that fit within maxWidth.
 * If maxWidth is null, each paragraph (split by \n) is one line (point text).
 */
export function wrapText(
  text: string,
  maxWidth: number | null,
  measureWidth: (text: string) => number,
): string[] {
  const paragraphs = text.split('\n');

  if (maxWidth === null || maxWidth <= 0) {
    return paragraphs;
  }

  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/(\s+)/);
    let currentLine = '';

    for (const word of words) {
      if (currentLine === '') {
        currentLine = word;
        continue;
      }

      const testLine = currentLine + word;
      if (measureWidth(testLine) <= maxWidth) {
        currentLine = testLine;
      } else {
        // If the word itself is a space separator, just push current line
        if (/^\s+$/.test(word)) {
          lines.push(currentLine);
          currentLine = '';
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
    }

    if (currentLine !== '') {
      lines.push(currentLine);
    }
  }

  // If input ends with newline, add empty trailing line
  if (text.endsWith('\n')) {
    lines.push('');
  }

  return lines;
}

/**
 * Compute the x offset for a line of text given alignment and container width.
 *
 * For area text (containerWidth is a number), the offset is measured from the
 * left edge of the container. For point text (containerWidth is null), the
 * offset is measured from the click anchor and may be negative — center
 * alignment shifts the line so the anchor sits at its midpoint, right
 * alignment shifts it so the anchor sits at its trailing edge.
 */
export function alignLineX(
  lineWidth: number,
  containerWidth: number | null,
  align: TextAlign,
): number {
  if (containerWidth === null) {
    switch (align) {
      case 'center': return -lineWidth / 2;
      case 'right': return -lineWidth;
      default: return 0;
    }
  }
  switch (align) {
    case 'center': return (containerWidth - lineWidth) / 2;
    case 'right': return containerWidth - lineWidth;
    default: return 0;
  }
}

/**
 * Render text onto a PixelSurface using an offscreen canvas.
 * Supports area text (wrapping), alignment, and multi-line.
 */
export function renderText(
  buf: PixelSurface,
  pos: Point,
  text: string,
  style: TextStyle,
  areaWidth: number | null = null,
): void {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = buf.width;
  tempCanvas.height = buf.height;
  const ctx = tempCanvas.getContext('2d', contextOptions);
  if (!ctx) return;

  const font = buildFontString(style);
  ctx.font = font;
  ctx.fillStyle = `rgba(${style.color.r},${style.color.g},${style.color.b},${style.color.a})`;
  ctx.textBaseline = 'top';

  if (style.letterSpacing !== 0) {
    (ctx as unknown as Record<string, unknown>).letterSpacing = `${style.letterSpacing}px`;
  }

  const measureWidth = (t: string): number => ctx.measureText(t).width;
  const lines = wrapText(text, areaWidth, measureWidth);
  const lineH = style.fontSize * style.lineHeight;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineWidth = measureWidth(line);
    const xOffset = alignLineX(lineWidth, areaWidth, style.textAlign);
    ctx.fillText(line, pos.x + xOffset, pos.y + i * lineH);
  }

  const textData = ctx.getImageData(0, 0, buf.width, buf.height);
  for (let i = 0; i < textData.data.length; i += 4) {
    const sa = (textData.data[i + 3] ?? 0) / 255;
    if (sa <= 0) continue;
    const px = (i / 4) % buf.width;
    const py = Math.floor(i / 4 / buf.width);
    const existing = buf.getPixel(px, py);
    const outA = sa + existing.a * (1 - sa);
    if (outA > 0) {
      buf.setPixel(px, py, {
        r: Math.round(((textData.data[i] ?? 0) * sa + existing.r * existing.a * (1 - sa)) / outA),
        g: Math.round(((textData.data[i + 1] ?? 0) * sa + existing.g * existing.a * (1 - sa)) / outA),
        b: Math.round(((textData.data[i + 2] ?? 0) * sa + existing.b * existing.a * (1 - sa)) / outA),
        a: outA,
      });
    }
  }
}

export interface TextLayoutMetrics {
  /**
   * X offset (relative to the click anchor / area-left) where the canvas's
   * top-left should be placed in document space.
   */
  readonly offsetX: number;
  /** Y offset of the canvas top-left relative to the anchor's y. */
  readonly offsetY: number;
  /** Canvas width in pixels (sized to fit text with padding). */
  readonly width: number;
  /** Canvas height in pixels. */
  readonly height: number;
  /**
   * Position within the canvas where text rendering should start. Passing
   * this as `pos` to renderTextToCanvas reproduces the same layout.
   */
  readonly renderOffsetX: number;
  readonly renderOffsetY: number;
}

function defaultMeasureWidthFn(style: TextStyle): ((t: string) => number) | null {
  if (typeof document === 'undefined') return null;
  const measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d', contextOptions);
  if (!ctx) return null;
  ctx.font = buildFontString(style);
  if (style.letterSpacing !== 0) {
    (ctx as unknown as Record<string, unknown>).letterSpacing = `${style.letterSpacing}px`;
  }
  return (t: string) => ctx.measureText(t).width;
}

/**
 * Compute a tight canvas size that fits all rendered glyphs (with antialias /
 * descender padding) for the given text + style + areaWidth, plus the offset
 * where the canvas should be placed relative to the click anchor (point text)
 * or the area's top-left (area text). The optional `measureWidth` parameter
 * lets unit tests provide a deterministic measurement function.
 */
export function computeTextLayout(
  text: string,
  style: TextStyle,
  areaWidth: number | null,
  measureWidth?: (t: string) => number,
): TextLayoutMetrics {
  const measure = measureWidth ?? defaultMeasureWidthFn(style);
  if (!measure) {
    return { offsetX: 0, offsetY: 0, width: 1, height: 1, renderOffsetX: 0, renderOffsetY: 0 };
  }

  const lines = wrapText(text, areaWidth, measure);
  const lineH = style.fontSize * style.lineHeight;

  let minRenderX = Number.POSITIVE_INFINITY;
  let maxRenderX = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    const lw = measure(line);
    const xOff = alignLineX(lw, areaWidth, style.textAlign);
    if (xOff < minRenderX) minRenderX = xOff;
    if (xOff + lw > maxRenderX) maxRenderX = xOff + lw;
  }
  if (!isFinite(minRenderX)) {
    minRenderX = 0;
    maxRenderX = 0;
  }

  // Padding so antialiased edges, descenders, and italic overshoot survive.
  const pad = Math.max(2, Math.ceil(style.fontSize * 0.5));

  const renderedWidth = Math.max(0, maxRenderX - minRenderX);
  const renderedHeight = Math.max(0, lines.length * lineH);

  const width = Math.max(1, Math.ceil(renderedWidth) + pad * 2);
  const height = Math.max(1, Math.ceil(renderedHeight) + pad * 2);

  const renderOffsetX = pad - minRenderX;
  const renderOffsetY = pad;

  return {
    offsetX: -renderOffsetX,
    offsetY: -renderOffsetY,
    width,
    height,
    renderOffsetX,
    renderOffsetY,
  };
}

/**
 * Render text onto a canvas sized to fit the rendered glyphs. Returns the
 * canvas plus the offset (relative to the click anchor / area-left) where
 * the canvas top-left should be placed in document space.
 */
export function rasterizeText(
  text: string,
  style: TextStyle,
  areaWidth: number | null,
): { canvas: HTMLCanvasElement; layout: TextLayoutMetrics } {
  const layout = computeTextLayout(text, style, areaWidth);
  const canvas = renderTextToCanvas(
    layout.width,
    layout.height,
    { x: layout.renderOffsetX, y: layout.renderOffsetY },
    text,
    style,
    areaWidth,
  );
  return { canvas, layout };
}

/**
 * Render text to a standalone canvas (for text layer commit).
 * Returns the canvas element directly to avoid the getImageData
 * unpremultiply round-trip that causes alpha precision loss on
 * antialiased text edges.
 */
export function renderTextToCanvas(
  width: number,
  height: number,
  pos: Point,
  text: string,
  style: TextStyle,
  areaWidth: number | null = null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return canvas;

  const font = buildFontString(style);
  ctx.font = font;
  ctx.fillStyle = `rgba(${style.color.r},${style.color.g},${style.color.b},${style.color.a})`;
  ctx.textBaseline = 'top';

  if (style.letterSpacing !== 0) {
    (ctx as unknown as Record<string, unknown>).letterSpacing = `${style.letterSpacing}px`;
  }

  const measureWidth = (t: string): number => ctx.measureText(t).width;
  const lines = wrapText(text, areaWidth, measureWidth);
  const lineH = style.fontSize * style.lineHeight;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineWidth = measureWidth(line);
    const xOffset = alignLineX(lineWidth, areaWidth, style.textAlign);
    ctx.fillText(line, pos.x + xOffset, pos.y + i * lineH);
  }

  return canvas;
}
