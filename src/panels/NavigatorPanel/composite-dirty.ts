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
 * Signals composed here:
 *   - `pixelDataManager.version()` — bumps on every pixel edit.
 *   - `useEditorStore.getState().document` reference identity — a new
 *     reference on any layer property change (visibility, opacity, blend,
 *     effects, mask, order, position, add/remove), document resize,
 *     background, colorMode, and adjustment-node edits.
 *   - `useUIStore` fields that reach the compositor: `channelVisibility`
 *     (Channels panel eye icons), `maskMode` (layerMask overlay,
 *     quickMask), and image `adjustments` / `adjustmentsEnabled`. These
 *     can be changed via panel clicks that never go through the canvas
 *     pointer path, so the scheduler's `isInteracting` catch-up does not
 *     cover them (#723).
 */

import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
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

  const uiInitial = useUIStore.getState();
  let prevChannels = uiInitial.channelVisibility;
  let prevMaskMode = uiInitial.maskMode;
  let prevAdjustments = uiInitial.adjustments;
  let prevAdjustmentsEnabled = uiInitial.adjustmentsEnabled;
  useUIStore.subscribe((state) => {
    if (
      state.channelVisibility !== prevChannels ||
      state.maskMode !== prevMaskMode ||
      state.adjustments !== prevAdjustments ||
      state.adjustmentsEnabled !== prevAdjustmentsEnabled
    ) {
      prevChannels = state.channelVisibility;
      prevMaskMode = state.maskMode;
      prevAdjustments = state.adjustments;
      prevAdjustmentsEnabled = state.adjustmentsEnabled;
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
