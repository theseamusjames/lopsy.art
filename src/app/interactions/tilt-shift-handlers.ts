import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { hitTestTiltShift } from '../rendering/render-tilt-shift-overlay';
import { previewTiltShift } from '../MenuBar/tilt-shift-actions';
import type { Point } from '../../types';

function getProjected(x: number, y: number, docW: number, docH: number, angleDeg: number): number {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const u = x / docW;
  const v = y / docH;
  return (u - 0.5) * (-sinA) + (v - 0.5) * cosA + 0.5;
}

export function handleTiltShiftDown(canvasPos: Point): boolean {
  const ui = useUIStore.getState();
  const session = ui.tiltShift;
  if (!session) return false;

  const doc = useEditorStore.getState().document;
  const zoom = useEditorStore.getState().viewport.zoom;
  const target = hitTestTiltShift(canvasPos.x, canvasPos.y, session, doc.width, doc.height, zoom);
  if (!target) return false;

  let anchor = 0;
  if (target === 'line1') {
    anchor = session.focusPosition + session.focusWidth * 0.5;
  } else if (target === 'line2') {
    anchor = session.focusPosition - session.focusWidth * 0.5;
  }

  ui.setTiltShiftDragging(target, anchor);
  return true;
}

export function handleTiltShiftMove(canvasPos: Point, metaKey: boolean): void {
  const ui = useUIStore.getState();
  const session = ui.tiltShift;
  if (!session || !session.dragging) return;

  const doc = useEditorStore.getState().document;
  const { dragging, dragAnchor } = session;

  if (dragging === 'angle') {
    const cx = doc.width / 2;
    const cy = doc.height / 2;
    const visualAngle = Math.atan2(canvasPos.y - cy, canvasPos.x - cx);
    const shaderAngle = Math.atan2(
      Math.sin(visualAngle) * doc.width,
      Math.cos(visualAngle) * doc.height,
    );
    let angleDeg = (shaderAngle * 180) / Math.PI;
    angleDeg = ((angleDeg % 360) + 360) % 360;
    if (metaKey) {
      angleDeg = Math.round(angleDeg / 15) * 15;
    }
    ui.updateTiltShift({ angle: angleDeg });
  } else if (dragging === 'center') {
    const projected = getProjected(canvasPos.x, canvasPos.y, doc.width, doc.height, session.angle);
    ui.updateTiltShift({ focusPosition: Math.max(0, Math.min(1, projected)) });
  } else {
    const projected = getProjected(canvasPos.x, canvasPos.y, doc.width, doc.height, session.angle);
    const a = Math.min(projected, dragAnchor);
    const b = Math.max(projected, dragAnchor);
    ui.updateTiltShift({
      focusPosition: (a + b) / 2,
      focusWidth: Math.max(0, b - a),
    });
  }

  previewTiltShift();
}

export function handleTiltShiftUp(): void {
  const ui = useUIStore.getState();
  if (ui.tiltShift?.dragging !== null) {
    ui.setTiltShiftDragging(null);
  }
}
