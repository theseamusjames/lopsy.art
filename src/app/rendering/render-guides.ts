import type { Guide, RulerHover } from '../ui-store';

const RULER_SIZE = 20;
const GUIDE_COLOR = 'rgba(0, 180, 255, 0.7)';
const GUIDE_ACTIVE_COLOR = 'rgba(0, 220, 255, 1)';
const PLAYHEAD_HOVER_COLOR = 'rgba(255, 255, 255, 0.9)';
const PLAYHEAD_SELECTED_COLOR = 'rgba(255, 255, 255, 1)';
const PLAYHEAD_COLOR = 'rgba(0, 180, 255, 0.9)';
const TOOLTIP_BG = 'rgba(0, 0, 0, 0.8)';
const TOOLTIP_TEXT = '#ffffff';
const PLAYHEAD_SIZE = 6;

/**
 * Render guide lines on the canvas in document-space.
 * Called inside the document-space transform.
 */
export function renderGuides(
  ctx: CanvasRenderingContext2D,
  guides: readonly Guide[],
  selectedGuideId: string | null,
  docWidth: number,
  docHeight: number,
  zoom: number,
): void {
  for (const guide of guides) {
    const isSelected = guide.id === selectedGuideId;
    ctx.strokeStyle = isSelected ? GUIDE_ACTIVE_COLOR : GUIDE_COLOR;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    if (guide.orientation === 'vertical') {
      ctx.moveTo(guide.position, 0);
      ctx.lineTo(guide.position, docHeight);
    } else {
      ctx.moveTo(0, guide.position);
      ctx.lineTo(docWidth, guide.position);
    }
    ctx.stroke();
  }
}

/**
 * Render a preview guide line when hovering over the ruler.
 * Called inside the document-space transform.
 */
export function renderGuidePreview(
  ctx: CanvasRenderingContext2D,
  rulerHover: RulerHover,
  docWidth: number,
  docHeight: number,
  zoom: number,
): void {
  ctx.strokeStyle = PLAYHEAD_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  if (rulerHover.orientation === 'vertical') {
    ctx.moveTo(rulerHover.position, 0);
    ctx.lineTo(rulerHover.position, docHeight);
  } else {
    ctx.moveTo(0, rulerHover.position);
    ctx.lineTo(docWidth, rulerHover.position);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Render playhead indicators on the rulers and tooltip for hover state.
 * Called in screen-space (after the document transform is restored).
 */
export function renderGuideRulerOverlays(
  ctx: CanvasRenderingContext2D,
  guides: readonly Guide[],
  selectedGuideId: string | null,
  hoveredGuideId: string | null,
  rulerHover: RulerHover | null,
  canvasWidth: number,
  canvasHeight: number,
  viewport: { panX: number; panY: number; zoom: number },
  docWidth: number,
  docHeight: number,
): void {
  const { panX, panY, zoom } = viewport;
  const originX = panX + canvasWidth / 2 - (docWidth / 2) * zoom;
  const originY = panY + canvasHeight / 2 - (docHeight / 2) * zoom;

  // Draw playhead triangles on rulers for placed guides
  for (const guide of guides) {
    const isSelected = guide.id === selectedGuideId;
    const isHovered = guide.id === hoveredGuideId;
    ctx.fillStyle = isSelected ? PLAYHEAD_SELECTED_COLOR : isHovered ? PLAYHEAD_HOVER_COLOR : GUIDE_COLOR;

    if (guide.orientation === 'vertical') {
      const screenX = originX + guide.position * zoom;
      if (screenX < RULER_SIZE || screenX > canvasWidth) continue;
      // Triangle pointing down on horizontal ruler
      ctx.beginPath();
      ctx.moveTo(screenX, RULER_SIZE);
      ctx.lineTo(screenX - PLAYHEAD_SIZE, RULER_SIZE - PLAYHEAD_SIZE * 1.5);
      ctx.lineTo(screenX + PLAYHEAD_SIZE, RULER_SIZE - PLAYHEAD_SIZE * 1.5);
      ctx.closePath();
      ctx.fill();
    } else {
      const screenY = originY + guide.position * zoom;
      if (screenY < RULER_SIZE || screenY > canvasHeight) continue;
      // Triangle pointing right on vertical ruler
      ctx.beginPath();
      ctx.moveTo(RULER_SIZE, screenY);
      ctx.lineTo(RULER_SIZE - PLAYHEAD_SIZE * 1.5, screenY - PLAYHEAD_SIZE);
      ctx.lineTo(RULER_SIZE - PLAYHEAD_SIZE * 1.5, screenY + PLAYHEAD_SIZE);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw hover playhead + tooltip (skip if hovering an existing guide)
  if (rulerHover && !hoveredGuideId) {
    ctx.fillStyle = PLAYHEAD_COLOR;

    if (rulerHover.orientation === 'vertical') {
      const screenX = originX + rulerHover.position * zoom;
      if (screenX >= RULER_SIZE && screenX <= canvasWidth) {
        // Playhead triangle
        ctx.beginPath();
        ctx.moveTo(screenX, RULER_SIZE);
        ctx.lineTo(screenX - PLAYHEAD_SIZE, RULER_SIZE - PLAYHEAD_SIZE * 1.5);
        ctx.lineTo(screenX + PLAYHEAD_SIZE, RULER_SIZE - PLAYHEAD_SIZE * 1.5);
        ctx.closePath();
        ctx.fill();

        // Tooltip
        drawTooltip(ctx, Math.round(rulerHover.position).toString(), screenX, RULER_SIZE + 4, canvasWidth, canvasHeight);
      }
    } else {
      const screenY = originY + rulerHover.position * zoom;
      if (screenY >= RULER_SIZE && screenY <= canvasHeight) {
        // Playhead triangle
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE, screenY);
        ctx.lineTo(RULER_SIZE - PLAYHEAD_SIZE * 1.5, screenY - PLAYHEAD_SIZE);
        ctx.lineTo(RULER_SIZE - PLAYHEAD_SIZE * 1.5, screenY + PLAYHEAD_SIZE);
        ctx.closePath();
        ctx.fill();

        // Tooltip
        drawTooltip(ctx, Math.round(rulerHover.position).toString(), RULER_SIZE + 4, screenY, canvasWidth, canvasHeight);
      }
    }
  }
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.save();
  ctx.font = '11px Inter, sans-serif';
  const metrics = ctx.measureText(text);
  const padding = 4;
  const tooltipW = metrics.width + padding * 2;
  const tooltipH = 16;

  // Keep tooltip on screen
  let tx = x;
  let ty = y;
  if (tx + tooltipW > canvasWidth) tx = canvasWidth - tooltipW;
  if (ty + tooltipH > canvasHeight) ty = canvasHeight - tooltipH;

  ctx.fillStyle = TOOLTIP_BG;
  ctx.beginPath();
  ctx.roundRect(tx, ty, tooltipW, tooltipH, 3);
  ctx.fill();

  ctx.fillStyle = TOOLTIP_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tx + padding, ty + tooltipH / 2);
  ctx.restore();
}
