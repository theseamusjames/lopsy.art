/**
 * Composite-input version — a monotonically-increasing counter that bumps
 * whenever something that changes the *composite thumbnail's contents*
 * changes. Viewport pan/zoom deliberately do NOT bump this: the composite
 * texture itself does not change during navigation, only the viewport
 * transform applied at final blit.
 *
 * Used by the Navigator scheduler to skip readbacks when the composite has
 * not changed since the last read (#711). Without it, the scheduler polls
 * every 200 ms forever, stalling the GPU pipeline five times per second on
 * a document that has not changed a single pixel.
 *
 * Two signals compose here:
 *   - `pixelDataManager.version()` — bumps on every pixel edit.
 *   - `useEditorStore.getState().document` reference identity — a new
 *     reference on any layer property change (visibility, opacity, blend,
 *     effects, mask, order, position, add/remove), document resize,
 *     background, colorMode, and adjustment-node edits.
 *
 * UI-store fields that also affect the composite (image adjustments,
 * channel visibility, mask edit mode) are not explicitly tracked here —
 * they are always changed via a pointer gesture, so the scheduler's
 * `isInteracting` catch-up fires the next read regardless.
 */

import { useEditorStore } from '../../app/editor-store';
import { pixelDataManager } from '../../engine/pixel-data-manager';

let version = 0;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;

  let prevDoc = useEditorStore.getState().document;
  useEditorStore.subscribe((state) => {
    if (state.document !== prevDoc) {
      prevDoc = state.document;
      version++;
    }
  });

  pixelDataManager.subscribe(() => {
    version++;
  });
}

export function getCompositeInputVersion(): number {
  ensureSubscribed();
  return version;
}
