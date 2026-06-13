import { traceSelectionContours } from '../../selection/selection';
import { getHandlePositions } from '../../tools/transform/transform';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';
import type { Rect } from '../../types';

export interface SelectionData {
  active: boolean;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
  bounds?: Rect | null;
}

let cachedMaskRef: Uint8ClampedArray | null = null;
let cachedContours: number[][] = [];

export function renderSelectionAnts(
  ctx: CanvasRenderingContext2D,
  selection: SelectionData,
  zoom: number,
  antPhase: number,
  transform?: TransformState | null,
): void {
  if (!selection.active || !selection.mask) return;

  if (selection.mask !== cachedMaskRef) {
    cachedContours = traceSelectionContours(selection.mask, selection.maskWidth, selection.maskHeight, selection.bounds);
    cachedMaskRef = selection.mask;
  }

  if (cachedContours.length === 0) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (transform) {
    const ob = transform.originalBounds;
    const cx = ob.x + ob.width / 2;
    const cy = ob.y + ob.height / 2;
    ctx.translate(cx + transform.translateX, cy + transform.translateY);
    ctx.rotate(transform.rotation);
    ctx.scale(transform.scaleX, transform.scaleY);
    ctx.translate(-cx, -cy);
  }

  const lw = 1.5 / zoom;
  ctx.lineWidth = lw;
  const dashLen = 8 / zoom;

  const offset = (antPhase % 120) / 120 * dashLen * 2;

  const drawContours = () => {
    for (const pts of cachedContours) {
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i]!, pts[i + 1]!);
      }
      ctx.stroke();
    }
  };

  ctx.setLineDash([]);
  ctx.strokeStyle = '#000000';
  drawContours();

  ctx.setLineDash([dashLen, dashLen]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = '#ffffff';
  drawContours();

  ctx.restore();
}

/**
 * Draw marching ants for an in-progress marquee drag directly from its
 * rectangle/ellipse geometry — no mask, no contour tracing. Used by the live
 * preview so a drag never touches a full-resolution buffer or the GPU bridge.
 */
export function renderMarqueeDraftAnts(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  shape: 'rect' | 'ellipse',
  zoom: number,
  antPhase: number,
): void {
  if (rect.width <= 0 || rect.height <= 0) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  ctx.lineWidth = 1.5 / zoom;
  const dashLen = 8 / zoom;
  const offset = (antPhase % 120) / 120 * dashLen * 2;

  const trace = () => {
    ctx.beginPath();
    if (shape === 'ellipse') {
      ctx.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0, 0, Math.PI * 2,
      );
    } else {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }
  };

  ctx.setLineDash([]);
  ctx.strokeStyle = '#000000';
  trace();
  ctx.stroke();

  ctx.setLineDash([dashLen, dashLen]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = '#ffffff';
  trace();
  ctx.stroke();

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
