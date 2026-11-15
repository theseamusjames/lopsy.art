import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { PAINT_TOOLS } from '../../tools/tool-registry';
import type { Point } from '../../types';

/**
 * #666 — Compute + publish the shift-hold line preview for paint tools.
 * Called from the canvas pointer-move handler on every hover event, and
 * from a global shift/meta key listener so the preview updates when the
 * modifier changes without pointer motion.
 *
 * Preconditions for a visible preview:
 *   1. Active tool is a paint tool (brush/pencil/eraser).
 *   2. Shift key is held.
 *   3. A `lastPaintPoint` exists and its layerId is the active layer.
 *   4. Cursor is inside the canvas.
 *
 * When meta/cmd is also held, the endpoint snaps to the nearest 15°
 * increment relative to the origin — mirroring `paint-handlers.ts`.
 */
export function updatePaintLinePreview(
  cursorDocPos: Point | null,
  shiftKey: boolean,
  metaKey: boolean,
  cursorOnCanvas: boolean,
): void {
  const ui = useUIStore.getState();
  const editor = useEditorStore.getState();

  if (!shiftKey || !cursorOnCanvas || !cursorDocPos) {
    if (ui.paintLinePreview) ui.setPaintLinePreview(null);
    return;
  }
  if (!PAINT_TOOLS.has(ui.activeTool)) {
    if (ui.paintLinePreview) ui.setPaintLinePreview(null);
    return;
  }
  const lastPoint = ui.lastPaintPoint;
  const activeLayerId = editor.document.activeLayerId;
  if (!lastPoint || lastPoint.layerId !== activeLayerId) {
    if (ui.paintLinePreview) ui.setPaintLinePreview(null);
    return;
  }

  // Convert `lastPoint.point` (layer-local) to doc space; convert cursorDocPos
  // (doc space already) to a layer-local end point for snapping, then back
  // to doc space so the overlay renderer stays doc-space.
  const layer = editor.document.layers.find((l) => l.id === activeLayerId);
  const lx = layer?.x ?? 0;
  const ly = layer?.y ?? 0;
  const startDoc = { x: lastPoint.point.x + lx, y: lastPoint.point.y + ly };
  let endDoc = { x: cursorDocPos.x, y: cursorDocPos.y };
  const snapped = metaKey;
  if (snapped) {
    const dx = endDoc.x - startDoc.x;
    const dy = endDoc.y - startDoc.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      const snapRad = Math.PI / 12; // 15°
      const snappedAngle = Math.round(Math.atan2(dy, dx) / snapRad) * snapRad;
      endDoc = {
        x: startDoc.x + dist * Math.cos(snappedAngle),
        y: startDoc.y + dist * Math.sin(snappedAngle),
      };
    }
  }
  ui.setPaintLinePreview({ start: startDoc, end: endDoc, snapped });
}

/**
 * The pointer-move handler already flushes cursorPosition into ui-store,
 * but that store update lags behind for keyboard-only changes (shift/meta
 * pressed without moving the mouse). This listener recomputes the preview
 * whenever those modifiers change, using the last known cursor position.
 * Install once at app mount.
 */
export function installPaintLinePreviewKeyListener(): () => void {
  const recompute = (e: KeyboardEvent) => {
    if (e.key !== 'Shift' && e.key !== 'Meta' && e.key !== 'Control') return;
    const ui = useUIStore.getState();
    if (!ui.cursorOnCanvas) {
      if (ui.paintLinePreview) ui.setPaintLinePreview(null);
      return;
    }
    // `e.shiftKey`/`e.metaKey` include the key event that just happened,
    // so keyup for Shift arrives with `e.shiftKey === false`.
    // We treat Ctrl as an alias for Meta on non-mac to match the paint
    // handler's snap key.
    const shift = e.shiftKey;
    const meta = e.metaKey || e.ctrlKey;
    updatePaintLinePreview(ui.cursorPosition, shift, meta, ui.cursorOnCanvas);
  };
  window.addEventListener('keydown', recompute);
  window.addEventListener('keyup', recompute);
  return () => {
    window.removeEventListener('keydown', recompute);
    window.removeEventListener('keyup', recompute);
  };
}
