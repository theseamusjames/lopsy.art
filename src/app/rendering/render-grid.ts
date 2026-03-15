import type { Point } from '../../types';

const RULER_SIZE = 20;
const RULER_BG = '#2a2a2a';
const RULER_TEXT = '#888888';
const RULER_TICK = '#555555';
const RULER_INDICATOR = '#4a9eff';

export function renderRulers(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  viewport: { panX: number; panY: number; zoom: number },
  docWidth: number,
  docHeight: number,
  cursorPosition: Point,
): void {
  const { panX, panY, zoom } = viewport;
  const originX = panX + canvasWidth / 2 - (docWidth / 2) * zoom;
  const originY = panY + canvasHeight / 2 - (docHeight / 2) * zoom;

  // Choose tick spacing based on zoom level
  const rawStep = 50 / zoom;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 2) step = mag * 1;
  else if (norm < 5) step = mag * 2;
  else step = mag * 5;
  if (step < 1) step = 1;

  ctx.save();

  // Horizontal ruler (top)
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, canvasWidth, RULER_SIZE);
  ctx.strokeStyle = RULER_TICK;
  ctx.lineWidth = 1;
  ctx.fillStyle = RULER_TEXT;
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const hStart = Math.floor(-originX / zoom / step) * step;
  const hEnd = Math.ceil((canvasWidth - originX) / zoom / step) * step;
  for (let px = hStart; px <= hEnd; px += step) {
    const screenX = originX + px * zoom;
    if (screenX < RULER_SIZE || screenX > canvasWidth) continue;
    ctx.beginPath();
    ctx.moveTo(screenX, RULER_SIZE - 6);
    ctx.lineTo(screenX, RULER_SIZE);
    ctx.stroke();
    ctx.fillStyle = RULER_TEXT;
    ctx.fillText(String(Math.round(px)), screenX + 2, 2);
  }

  // Bottom border line of horizontal ruler
  ctx.strokeStyle = RULER_TICK;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE);
  ctx.lineTo(canvasWidth, RULER_SIZE);
  ctx.stroke();

  // Vertical ruler (left)
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, RULER_SIZE, RULER_SIZE, canvasHeight - RULER_SIZE);
  ctx.strokeStyle = RULER_TICK;

  const vStart = Math.floor(-originY / zoom / step) * step;
  const vEnd = Math.ceil((canvasHeight - originY) / zoom / step) * step;
  for (let px = vStart; px <= vEnd; px += step) {
    const screenY = originY + px * zoom;
    if (screenY < RULER_SIZE || screenY > canvasHeight) continue;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE - 6, screenY);
    ctx.lineTo(RULER_SIZE, screenY);
    ctx.stroke();
    ctx.save();
    ctx.translate(2, screenY + 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = RULER_TEXT;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(Math.round(px)), 0, 0);
    ctx.restore();
  }

  // Right border line of vertical ruler
  ctx.strokeStyle = RULER_TICK;
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE, RULER_SIZE);
  ctx.lineTo(RULER_SIZE, canvasHeight);
  ctx.stroke();

  // Corner square
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

  // Cursor indicator lines (blue)
  const cursorScreenX = originX + cursorPosition.x * zoom;
  const cursorScreenY = originY + cursorPosition.y * zoom;

  ctx.strokeStyle = RULER_INDICATOR;
  ctx.lineWidth = 1;

  // Horizontal indicator
  if (cursorScreenX >= RULER_SIZE && cursorScreenX <= canvasWidth) {
    ctx.beginPath();
    ctx.moveTo(cursorScreenX, 0);
    ctx.lineTo(cursorScreenX, RULER_SIZE);
    ctx.stroke();
  }

  // Vertical indicator
  if (cursorScreenY >= RULER_SIZE && cursorScreenY <= canvasHeight) {
    ctx.beginPath();
    ctx.moveTo(0, cursorScreenY);
    ctx.lineTo(RULER_SIZE, cursorScreenY);
    ctx.stroke();
  }

  ctx.restore();
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  docWidth: number,
  docHeight: number,
  gridSize: number,
  zoom: number,
): void {
  ctx.save();

  // Minor grid lines
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.25)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = gridSize; x < docWidth; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, docHeight);
  }
  for (let y = gridSize; y < docHeight; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(docWidth, y);
  }
  ctx.stroke();

  // Major grid lines every 4 cells
  const majorStep = gridSize * 4;
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = majorStep; x < docWidth; x += majorStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, docHeight);
  }
  for (let y = majorStep; y < docHeight; y += majorStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(docWidth, y);
  }
  ctx.stroke();

  ctx.restore();
}
