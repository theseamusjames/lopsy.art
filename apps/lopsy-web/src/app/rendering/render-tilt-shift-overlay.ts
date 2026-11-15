import type { TiltShiftSession } from '../ui-store';

interface LineEndpoints {
  x1: number; y1: number;
  x2: number; y2: number;
}

function getLineEndpoints(
  projectedValue: number,
  cosA: number,
  sinA: number,
  docW: number,
  docH: number,
): LineEndpoints {
  // Reference point on the line projected=C, at the closest point to doc center
  const offset = projectedValue - 0.5;
  const uRef = 0.5 + offset * (-sinA);
  const vRef = 0.5 + offset * cosA;
  const xRef = uRef * docW;
  const yRef = vRef * docH;

  // Line tangent direction in document space
  const dirX = cosA * docW;
  const dirY = sinA * docH;

  const T = 2;
  return {
    x1: xRef - T * dirX,
    y1: yRef - T * dirY,
    x2: xRef + T * dirX,
    y2: yRef + T * dirY,
  };
}

export function renderTiltShiftOverlay(
  ctx: CanvasRenderingContext2D,
  session: TiltShiftSession,
  docW: number,
  docH: number,
  zoom: number,
): void {
  const { focusPosition, focusWidth, angle } = session;
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const halfWidth = focusWidth * 0.5;
  const line1Value = focusPosition - halfWidth;
  const line2Value = focusPosition + halfWidth;

  const line1 = getLineEndpoints(line1Value, cosA, sinA, docW, docH);
  const line2 = getLineEndpoints(line2Value, cosA, sinA, docW, docH);

  ctx.save();

  // Focal zone fill
  ctx.fillStyle = 'rgba(100, 180, 255, 0.06)';
  ctx.beginPath();
  ctx.moveTo(line1.x1, line1.y1);
  ctx.lineTo(line1.x2, line1.y2);
  ctx.lineTo(line2.x2, line2.y2);
  ctx.lineTo(line2.x1, line2.y1);
  ctx.closePath();
  ctx.fill();

  // Boundary lines
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.8)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);

  ctx.beginPath();
  ctx.moveTo(line1.x1, line1.y1);
  ctx.lineTo(line1.x2, line1.y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(line2.x1, line2.y1);
  ctx.lineTo(line2.x2, line2.y2);
  ctx.stroke();

  // Center line (subtle)
  const center = getLineEndpoints(focusPosition, cosA, sinA, docW, docH);
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.3)';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([3 / zoom, 6 / zoom]);
  ctx.beginPath();
  ctx.moveTo(center.x1, center.y1);
  ctx.lineTo(center.x2, center.y2);
  ctx.stroke();

  // Angle control at document center
  const cx = docW / 2;
  const cy = docH / 2;
  const circleRadius = 24 / zoom;

  // Visual angle accounts for aspect ratio so the handle direction
  // matches the on-screen line direction
  const visualAngle = Math.atan2(sinA * docH, cosA * docW);

  ctx.setLineDash([]);

  // Circle background + outline
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Angle indicator line (primary direction)
  const handleX = cx + circleRadius * Math.cos(visualAngle);
  const handleY = cy + circleRadius * Math.sin(visualAngle);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(handleX, handleY);
  ctx.stroke();

  // Opposite direction (dimmer)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - (handleX - cx), cy - (handleY - cy));
  ctx.stroke();

  // Handle dot
  const dotRadius = 4 / zoom;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.arc(handleX, handleY, dotRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Center dot
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5 / zoom, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export type TiltShiftHitTarget = 'line1' | 'line2' | 'center' | 'angle' | null;

export function hitTestTiltShift(
  canvasX: number,
  canvasY: number,
  session: TiltShiftSession,
  docW: number,
  docH: number,
  zoom: number,
): TiltShiftHitTarget {
  const { focusPosition, focusWidth, angle } = session;
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // 1. Angle control handle
  const cx = docW / 2;
  const cy = docH / 2;
  const circleRadius = 24 / zoom;
  const visualAngle = Math.atan2(sinA * docH, cosA * docW);
  const handleX = cx + circleRadius * Math.cos(visualAngle);
  const handleY = cy + circleRadius * Math.sin(visualAngle);

  if (Math.sqrt((canvasX - handleX) ** 2 + (canvasY - handleY) ** 2) * zoom < 12) return 'angle';
  if (Math.abs(Math.sqrt((canvasX - cx) ** 2 + (canvasY - cy) ** 2) - circleRadius) * zoom < 8) return 'angle';

  // 2. Projected value at cursor
  const u = canvasX / docW;
  const v = canvasY / docH;
  const projected = (u - 0.5) * (-sinA) + (v - 0.5) * cosA + 0.5;

  const halfWidth = focusWidth * 0.5;
  const line1Value = focusPosition - halfWidth;
  const line2Value = focusPosition + halfWidth;

  // Convert projected-space distance to screen pixels for hit testing
  const gradMag = Math.sqrt(sinA * sinA / (docW * docW) + cosA * cosA / (docH * docH));
  const threshold = gradMag > 0 ? 8 * gradMag / zoom : 0.02;

  const dist1 = Math.abs(projected - line1Value);
  const dist2 = Math.abs(projected - line2Value);

  if (dist1 < threshold && dist1 <= dist2) return 'line1';
  if (dist2 < threshold) return 'line2';

  // 3. Between lines
  if (projected > line1Value && projected < line2Value) return 'center';

  return null;
}
