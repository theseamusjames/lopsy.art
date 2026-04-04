import type { TextEditingState, TextDragState } from '../ui-store';
import { wrapText, alignLineX, buildFontString } from '../../tools/text/text';
import type { TextStyle } from '../../tools/text/text';

const BORDER_COLOR = '#2196F3';
const CURSOR_COLOR = '#2196F3';

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
 * Render the text editing chrome: bounding box border and blinking cursor.
 * The actual text is rendered by the GPU engine via the layer's pixel data
 * (updated in real-time by syncTextEditingPixels) so the preview matches
 * the committed result exactly.
 */
export function renderTextEditOverlay(
  ctx: CanvasRenderingContext2D,
  editing: TextEditingState,
  style: TextStyle,
  zoom: number,
  cursorBlinkPhase: number,
): void {
  const { bounds, text, cursorPos } = editing;

  // Draw text area border (only for area text)
  if (bounds.width !== null) {
    ctx.save();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height ?? bounds.width);
    ctx.restore();
  }

  // Render cursor (blinking)
  const showCursor = cursorBlinkPhase % 60 < 30;
  if (showCursor) {
    ctx.save();
    const font = buildFontString(style);
    ctx.font = font;
    ctx.textBaseline = 'top';

    const measureWidth = (t: string): number => ctx.measureText(t).width;
    const lines = wrapText(text, bounds.width, measureWidth);
    const lineH = style.fontSize * style.lineHeight;

    let charsSoFar = 0;
    let cursorLine = 0;
    let cursorLineOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineLen = line.length;
      if (charsSoFar + lineLen >= cursorPos) {
        cursorLine = i;
        cursorLineOffset = cursorPos - charsSoFar;
        break;
      }
      charsSoFar += lineLen;
      const nextCharInText = text[charsSoFar];
      if (nextCharInText === '\n') {
        charsSoFar += 1;
      }
      if (charsSoFar >= cursorPos) {
        cursorLine = i + 1;
        cursorLineOffset = 0;
        break;
      }
    }

    const lineText = lines[cursorLine] ?? '';
    const textBeforeCursor = lineText.slice(0, cursorLineOffset);
    const cursorX = bounds.x + measureWidth(textBeforeCursor) +
      alignLineX(measureWidth(lineText), bounds.width, style.textAlign);
    const cursorY = bounds.y + cursorLine * lineH;

    ctx.strokeStyle = CURSOR_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cursorX, cursorY);
    ctx.lineTo(cursorX, cursorY + lineH);
    ctx.stroke();
    ctx.restore();
  }
}
