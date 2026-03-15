import { traceSelectionContours } from '../../selection/selection';
import { getHandlePositions } from '../../tools/transform/transform';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';

export interface SelectionData {
  active: boolean;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

export function renderSelectionAnts(
  ctx: CanvasRenderingContext2D,
  selection: SelectionData,
  zoom: number,
  antPhase: number,
): void {
  if (!selection.active || !selection.mask) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const lw = 1.5 / zoom;
  ctx.lineWidth = lw;
  const dashLen = 8 / zoom;
  ctx.setLineDash([dashLen, dashLen]);

  const offset = (antPhase % 120) / 120 * dashLen * 2;

  const contours = traceSelectionContours(selection.mask, selection.maskWidth, selection.maskHeight);

  const drawContours = () => {
    for (const pts of contours) {
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i]!, pts[i + 1]!);
      }
      ctx.stroke();
    }
  };

  // Black base — fully visible everywhere
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000000';
  drawContours();

  // White dashes march on top
  ctx.setLineDash([dashLen, dashLen]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = '#ffffff';
  drawContours();

  ctx.restore();
}

export function renderTransformHandles(
  ctx: CanvasRenderingContext2D,
  selection: SelectionData,
  transform: TransformState | null,
  zoom: number,
): void {
  if (!selection.active || !transform) return;

  const handles = getHandlePositions(transform);
  const handleSize = 6 / zoom;
  const rotHandleSize = 5 / zoom;

  ctx.save();
  ctx.setLineDash([]);

  const scaleHandleKeys: TransformHandle[] = [
    'top-left', 'top-right', 'bottom-right', 'bottom-left',
  ];
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let i = 0; i < scaleHandleKeys.length; i++) {
    const key = scaleHandleKeys[i] as TransformHandle;
    const pos = handles[key];
    if (i === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  }
  ctx.closePath();
  ctx.stroke();

  const allScaleHandles: TransformHandle[] = [
    'top-left', 'top', 'top-right', 'right',
    'bottom-right', 'bottom', 'bottom-left', 'left',
  ];
  for (const key of allScaleHandles) {
    const pos = handles[key];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
  }

  const rotHandleKeys: TransformHandle[] = [
    'rotate-top-left', 'rotate-top-right',
    'rotate-bottom-right', 'rotate-bottom-left',
  ];
  const cornerForRot: Record<string, TransformHandle> = {
    'rotate-top-left': 'top-left',
    'rotate-top-right': 'top-right',
    'rotate-bottom-right': 'bottom-right',
    'rotate-bottom-left': 'bottom-left',
  };
  for (const key of rotHandleKeys) {
    const pos = handles[key];
    const cornerKey = cornerForRot[key] as TransformHandle;
    const cornerPos = handles[cornerKey];

    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(cornerPos.x, cornerPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rotHandleSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
