import type { TextEditingState, TextDragState } from '../ui-store';
import type { TextStyle } from '../../tools/text/text';
import type { Point, TextLayer } from '../../types';

const BORDER_COLOR = '#2196F3';
const CURSOR_COLOR = '#2196F3';
const HOVER_COLOR = 'rgba(33,150,243,0.6)';
const SELECTION_COLOR = 'rgba(33,150,243,0.3)';

/** Caret geometry in engine layout space: `[x, top, height]`. */
export type CursorRect = readonly [number, number, number];

/**
 * Render a subtle bounding box around a text layer to indicate it's clickable.
 * Shown when the text tool is active and the cursor hovers over the layer.
 */
export function renderTextHoverBounds(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  zoom: number,
  texW: number,
  texH: number,
): void {
  ctx.save();
  ctx.strokeStyle = HOVER_COLOR;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(layer.x, layer.y, texW, texH);
  ctx.restore();
}

/**
 * Outline a transformed text layer's layout box (corners in document space)
 * on hover, matching the rotated glyphs rather than their texture's
 * axis-aligned bounds.
 */
export function renderTextHoverFrame(
  ctx: CanvasRenderingContext2D,
  corners: readonly Point[],
  zoom: number,
): void {
  if (corners.length < 3) return;
  ctx.save();
  ctx.strokeStyle = HOVER_COLOR;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Render the text area drag preview (just the box outline, no text).
 */
export function renderTextDragOverlay(
  ctx: CanvasRenderingContext2D,
  drag: TextDragState,
  zoom: number,
): void {
  const x = Math.min(drag.startX, drag.currentX);
  const y = Math.min(drag.startY, drag.currentY);
  const w = Math.abs(drag.currentX - drag.startX);
  const h = Math.abs(drag.currentY - drag.startY);
  if (w < 2 && h < 2) return;

  ctx.save();
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/**
 * Render the text editing chrome: area border, selection highlight, and the
 * blinking caret. All glyph geometry (`cursorRect`, `selectionRects`) comes
 * from the engine in layout space relative to the text origin, which maps to
 * document space by adding `bounds.x`/`bounds.y` (and, for transformed text,
 * applying `editing.matrix` first). The text itself is rendered
 * by the GPU engine (via syncTextLayers) so the preview matches the commit.
 */
export function renderTextEditOverlay(
  ctx: CanvasRenderingContext2D,
  editing: TextEditingState,
  style: TextStyle,
  zoom: number,
  cursorBlinkPhase: number,
  cursorRect: CursorRect | null,
  selectionRects: readonly number[],
): void {
  const { bounds, matrix } = editing;
  if (!matrix) {
    drawEditChrome(ctx, editing, style, zoom, cursorBlinkPhase, cursorRect, selectionRects, bounds.x, bounds.y);
    return;
  }
  // Transformed text is edited in place: draw in layout space and let the
  // canvas carry it through the layer's matrix to the anchor.
  ctx.save();
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, bounds.x, bounds.y);
  // Keep strokes a constant on-screen width under the matrix's scale.
  const matrixScale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1;
  drawEditChrome(ctx, editing, style, zoom * matrixScale, cursorBlinkPhase, cursorRect, selectionRects, 0, 0);
  ctx.restore();
}

function drawEditChrome(
  ctx: CanvasRenderingContext2D,
  editing: TextEditingState,
  style: TextStyle,
  zoom: number,
  cursorBlinkPhase: number,
  cursorRect: CursorRect | null,
  selectionRects: readonly number[],
  originX: number,
  originY: number,
): void {
  const { bounds } = editing;

  // Draw text area border (only for area text).
  if (bounds.width !== null) {
    ctx.save();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(originX, originY, bounds.width, bounds.height ?? bounds.width);
    ctx.restore();
  }

  // Selection highlight — one rect per visual line, [x, top, w, h, ...].
  if (selectionRects.length >= 4) {
    ctx.save();
    ctx.fillStyle = SELECTION_COLOR;
    for (let i = 0; i + 3 < selectionRects.length; i += 4) {
      ctx.fillRect(
        originX + selectionRects[i]!,
        originY + selectionRects[i + 1]!,
        selectionRects[i + 2]!,
        selectionRects[i + 3]!,
      );
    }
    ctx.restore();
  }

  // Blinking caret.
  const showCursor = cursorBlinkPhase % 60 < 30;
  if (!showCursor) return;

  // Fall back to the bounds origin when the engine has no geometry yet
  // (e.g. empty text before the first layout).
  const [cx, cTop, cHeight] = cursorRect
    ?? [0, 0, style.fontSize * style.lineHeight];

  ctx.save();
  ctx.strokeStyle = CURSOR_COLOR;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(originX + cx, originY + cTop);
  ctx.lineTo(originX + cx, originY + cTop + cHeight);
  ctx.stroke();
  ctx.restore();
}
