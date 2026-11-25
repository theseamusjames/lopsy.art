import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import type { TransformMode, TransformState } from '../../tools/transform/transform';
import { createTransformState, isShapeChangingTransform, mapRectThroughInverse } from '../../tools/transform/transform';
import {
  flipTransform,
  resolveLayerTransformTargets,
  rotateTransform90,
  selectionWantsLayerTransform,
} from '../../tools/transform/multi-layer-transform';
import type { TextMatrix } from '../../tools/text/text-transform';
import { getTextTransformTarget, refusePartialTextMove } from './text-transform-handlers';
import { refuseMaskEditSelectionMove } from './mask-edit-move-guard';
import { transformTextLayerInDocument } from '../text-layer-transform';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloatAffine,
  dropFloat,
  hasFloat,
  setSelectionMask,
} from '../../engine-wasm/wasm-bridge';
import { reconcileLayerBoundsWithEngine } from '../reconcile-layer-bounds';
import { growFloatToCover } from './float-growth';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import { commitLiveFloat, withLiveFloatKept } from './live-float';
import {
  beginLayerTransformSession,
  beginLayerTransformSessionWhenMeasured,
  getLayerTransformBox,
  isLayerTransformCurrent,
  markLayerTransformDirty,
  refuseTextInLayerTransform,
  renderLayerTransform,
} from './layer-transform';
import { rotateActiveLayer } from '../MenuBar/menus/image-menu';
import type { Layer } from '../../types';

/**
 * What the Move tool's options-bar buttons do: Rotate 90° CW / CCW, and the
 * Flip Horizontal / Vertical and transform-mode buttons of its transform
 * controls. Which path a button takes depends on what is selected: a
 * marquee's pixels, the selected layers' shared box (several layers or a
 * group), a live text layer, or the one active layer.
 */

/**
 * Apply an instant GPU transform (flip/rotate) to the selected content:
 * 1. Float the selection on GPU
 * 2. Render with the given inverse matrix
 * 3. Drop float (commits to layer texture)
 * 4. Re-select from committed alpha (rebuilds mask cleanly)
 */
export function applyGpuTransform(invMatrix: Float32Array): void {
  const engine = getEngine();
  if (!engine) return;
  if (applyToLiveText(invMatrix)) return;
  if (refuseMaskEditSelectionMove()) return;

  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  if (!sel.active || !sel.bounds || !sel.mask) return;

  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;

  // The float, pending transform included, is handled below.
  withLiveFloatKept(() => editorState.pushHistory('Transform'));

  // A float left behind by a Move drag holds its lifted pixels at their
  // pre-drag position, while the selection (and the pixels the user sees)
  // have moved — the layer texture already holds that moved composite.
  // Transforming the stale float about the moved selection's centre threw
  // every pixel outside the float buffer (#822). Commit the moved result and
  // lift the current selection afresh. A float carrying a pending
  // rotate/scale is left alone.
  const pending = useUIStore.getState().transform;
  if (hasFloat(engine) && !(pending && isShapeChangingTransform(pending))) {
    dropFloat(engine);
  }

  const isFreshFloat = !hasFloat(engine);
  if (isFreshFloat) {
    const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
    setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);
    floatSelection(engine, activeLayerId);
    reconcileLayerBoundsWithEngine(engine, activeLayerId);
  }

  // A 90° turn can carry pixels past the float buffer (#818).
  growFloatToCover(engine, activeLayerId, mapRectThroughInverse(sel.bounds, invMatrix));

  // Apply transform centered on selection bounds
  const cx = sel.bounds.x + sel.bounds.width / 2;
  const cy = sel.bounds.y + sel.bounds.height / 2;
  // A kept float's pixels needn't match the selection's rect, so only a
  // fresh float passes its source rect for crisp axis-aligned edges.
  const srcW = isFreshFloat ? sel.bounds.width : 0;
  const srcH = isFreshFloat ? sel.bounds.height : 0;
  compositeFloatAffine(engine, invMatrix, cx, cy, cx, cy, srcW, srcH);

  // Drop float — layer texture now has the committed result
  dropFloat(engine);

  // Re-select from committed pixel alpha (handles JS data clearing + mask rebuild)
  void selectLayerAlpha(activeLayerId);
}

/**
 * Flip / rotate a live text layer by editing its transform instead of lifting
 * its pixels. Returns true when the request was handled — applied, or
 * refused because the selection holds only part of the text.
 */
function applyToLiveText(invMatrix: Float32Array): boolean {
  const target = getTextTransformTarget();
  if (target) {
    // The buttons pass the inverse; flips and quarter turns are
    // orthonormal, so the forward map is its transpose.
    const forward: TextMatrix = {
      a: invMatrix[0] ?? 1,
      b: invMatrix[3] ?? 0,
      c: invMatrix[1] ?? 0,
      d: invMatrix[4] ?? 1,
    };
    transformTextLayerInDocument(target.layer.id, forward, 'Transform');
    if (useEditorStore.getState().selection.active) void selectLayerAlpha(target.layer.id);
    return true;
  }
  return refusePartialTextMove();
}

export function rotateSelection(dir: 'cw' | 'ccw'): void {
  const matrix = dir === 'cw'
    ? new Float32Array([0, -1, 0, 1, 0, 0, 0, 0, 1])
    : new Float32Array([0, 1, 0, -1, 0, 0, 0, 0, 1]);
  applyGpuTransform(matrix);
}

/**
 * Run one instant step (flip, quarter turn) on the selected layers' shared
 * transform — on top of any pending scale or rotate — and bake it, as the
 * selection's flip buttons do. One "Transform" history row. Resolves once
 * the step is applied (later when the layers' bounds were still being read).
 */
export function applyLayerTransformStep(step: (t: TransformState) => TransformState): Promise<void> {
  const box = getLayerTransformBox();
  if (!box || refuseTextInLayerTransform(false)) return Promise.resolve();
  withLiveFloatKept(() => useEditorStore.getState().pushHistory('Transform'));
  const applyStep = (): void => {
    renderLayerTransform(step(useUIStore.getState().layerTransform ?? box));
    markLayerTransformDirty();
    commitLiveFloat();
  };
  if (!isLayerTransformCurrent()) {
    commitLiveFloat();
    const begun = beginLayerTransformSession(box);
    if (begun === 'nothing') return Promise.resolve();
    if (begun === 'unmeasured') {
      // The layers' content bounds are still being read; step when they are in.
      return beginLayerTransformSessionWhenMeasured(box).then((isBegun) => {
        if (isBegun) applyStep();
      });
    }
  }
  applyStep();
  return Promise.resolve();
}


/** Whether the Move tool frames the selected layers in one shared box: no marquee, and several layers or a group with something movable. */
export function wantsLayerTransform(selectionActive: boolean, layers: readonly Layer[], selectedIds: readonly string[]): boolean {
  if (selectionActive) return false;
  return selectionWantsLayerTransform(layers, selectedIds) && resolveLayerTransformTargets(layers, selectedIds).length > 0;
}

/** The Move options' Rotate 90° CW / CCW button. Resolves once the turn is applied. */
export function rotateFromMoveOptions(dir: 'cw' | 'ccw'): Promise<void> {
  if (useEditorStore.getState().selection.active) {
    rotateSelection(dir);
    return Promise.resolve();
  }
  if (getLayerTransformBox()) {
    // Several layers selected: turn them together about their shared centre.
    return applyLayerTransformStep((t) => rotateTransform90(t, dir));
  }
  return rotateActiveLayer(dir);
}

/** The transform controls' Flip Horizontal / Vertical button; `isLayerBox` is whether they frame the selected layers. */
export function flipFromMoveOptions(axis: 'horizontal' | 'vertical', isLayerBox: boolean): Promise<void> {
  if (isLayerBox) return applyLayerTransformStep((t) => flipTransform(t, axis));
  applyGpuTransform(axis === 'horizontal'
    ? new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1])
    : new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]));
  return Promise.resolve();
}

/**
 * A transform-mode button (Free, Skew, Distort, Perspective) of the
 * transform controls; `isLayerBox` is whether they frame the selected
 * layers. A live text layer's own Free / Skew buttons set
 * `textTransformMode` in the UI store instead.
 */
export function setTransformModeFromMoveOptions(mode: TransformMode, isLayerBox: boolean): void {
  if (isLayerBox) {
    // Bake the pending transform; the box starts again on the result.
    commitLiveFloat();
    useUIStore.getState().setLayerTransformMode(mode);
    return;
  }
  if (!useUIStore.getState().transform) return;
  // Commit any active transform before switching modes; the selection
  // takes on the transformed outline rather than the whole layer's alpha.
  commitLiveFloat();
  // Create fresh transform state with the new mode
  const sel = useEditorStore.getState().selection;
  if (sel.active && sel.bounds) {
    useUIStore.getState().setTransform(createTransformState(sel.bounds, mode));
  }
}
