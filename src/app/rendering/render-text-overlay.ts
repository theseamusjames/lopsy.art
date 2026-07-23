import type { TextEditingState, TextDragState } from '../ui-store';
import type { TextStyle } from '../../tools/text/text';
import type { TextLayer } from '../../types';

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
 * document space by adding `bounds.x`/`bounds.y`. The text itself is rendered
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
  const { bounds } = editing;

  // Draw text area border (only for area text).
  if (bounds.width !== null) {
    ctx.save();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height ?? bounds.width);
    ctx.restore();
  }

  // Selection highlight — one rect per visual line, [x, top, w, h, ...].
  if (selectionRects.length >= 4) {
    ctx.save();
    ctx.fillStyle = SELECTION_COLOR;
    for (let i = 0; i + 3 < selectionRects.length; i += 4) {
      ctx.fillRect(
        bounds.x + selectionRects[i]!,
        bounds.y + selectionRects[i + 1]!,
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
  ctx.moveTo(bounds.x + cx, bounds.y + cTop);
  ctx.lineTo(bounds.x + cx, bounds.y + cTop + cHeight);
  ctx.stroke();
  ctx.restore();
}
