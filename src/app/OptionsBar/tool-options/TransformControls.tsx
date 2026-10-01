import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import type { TransformMode, TransformState } from '../../../tools/transform/transform';
import {
  flipTransform,
  resolveLayerTransformTargets,
  selectionWantsLayerTransform,
} from '../../../tools/transform/multi-layer-transform';
import type { TextMatrix } from '../../../tools/text/text-transform';
import type { TextTransformMode } from '../../ui-store';
import { getTextTransformTarget, refusePartialTextMove } from '../../interactions/text-transform-handlers';
import { transformTextLayerInDocument } from '../../text-layer-transform';
import { createTransformState, isShapeChangingTransform, mapRectThroughInverse } from '../../../tools/transform/transform';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloatAffine,
  dropFloat,
  hasFloat,
  setSelectionMask,
} from '../../../engine-wasm/wasm-bridge';
import { reconcileLayerBoundsWithEngine } from '../../reconcile-layer-bounds';
import { growFloatToCover } from '../../interactions/float-growth';
import { selectLayerAlpha } from '../../../panels/LayerPanel/layer-selection';
import { commitLiveFloat, withLiveFloatKept } from '../../interactions/live-float';
import {
  beginLayerTransformSession,
  getLayerTransformBox,
  isLayerTransformCurrent,
  markLayerTransformDirty,
  renderLayerTransform,
} from '../../interactions/layer-transform';
import styles from './TransformControls.module.css';

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

  if (!hasFloat(engine)) {
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
  compositeFloatAffine(engine, invMatrix, cx, cy, cx, cy);

  // Drop float — layer texture now has the committed result
  dropFloat(engine);

  // Re-select from committed pixel alpha (handles JS data clearing + mask rebuild)
  selectLayerAlpha(activeLayerId);
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
    if (useEditorStore.getState().selection.active) selectLayerAlpha(target.layer.id);
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

const MODES: { id: TransformMode; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'skew', label: 'Skew' },
  { id: 'distort', label: 'Distort' },
  { id: 'perspective', label: 'Perspective' },
];

/**
 * Run one instant step (flip, quarter turn) on the selected layers' shared
 * transform — on top of any pending scale or rotate — and bake it, as the
 * selection's flip buttons do. One "Transform" history row.
 */
export function applyLayerTransformStep(step: (t: TransformState) => TransformState): void {
  const box = getLayerTransformBox();
  if (!box) return;
  withLiveFloatKept(() => useEditorStore.getState().pushHistory('Transform'));
  if (!isLayerTransformCurrent()) {
    commitLiveFloat();
    if (!beginLayerTransformSession(box)) return;
  }
  renderLayerTransform(step(useUIStore.getState().layerTransform ?? box));
  markLayerTransformDirty();
  commitLiveFloat();
}

/** Whether the Move tool frames the selected layers (no marquee, several layers or a group). */
function useWantsLayerTransform(): boolean {
  const selectionActive = useEditorStore((s) => s.selection.active);
  const layers = useEditorStore((s) => s.document.layers);
  const selectedIds = useEditorStore((s) => s.document.selectedLayerIds);
  if (selectionActive) return false;
  const ids = selectedIds ?? [];
  return selectionWantsLayerTransform(layers, ids) && resolveLayerTransformTargets(layers, ids).length > 0;
}

const TEXT_MODES: { id: TextTransformMode; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'skew', label: 'Skew' },
];

export function TransformControls() {
  const selectionActive = useEditorStore((s) => s.selection.active);
  const isLiveTextActive = useEditorStore((s) => {
    const layer = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return layer?.type === 'text' && !layer.pathId;
  });
  const transform = useUIStore((s) => s.transform);
  const setTransform = useUIStore((s) => s.setTransform);
  const layerTransformMode = useUIStore((s) => s.layerTransformMode);
  const setLayerTransformMode = useUIStore((s) => s.setLayerTransformMode);
  const isLayerBox = useWantsLayerTransform();
  const textMode = useUIStore((s) => s.textTransformMode);
  const setTextMode = useUIStore((s) => s.setTextTransformMode);
  // Several selected layers get the shared box; one text layer gets its own.
  const showsTextModes = isLiveTextActive && !isLayerBox;

  if (!selectionActive && !isLayerBox && !isLiveTextActive) return null;

  const currentMode = isLayerBox ? layerTransformMode : (transform?.mode ?? 'free');

  const handleModeChange = (mode: TransformMode) => {
    if (isLayerBox) {
      // Bake the pending transform; the box starts again on the result.
      commitLiveFloat();
      setLayerTransformMode(mode);
      return;
    }
    if (!transform) return;
    // Commit any active transform before switching modes; the selection
    // takes on the transformed outline rather than the whole layer's alpha.
    commitLiveFloat();
    // Create fresh transform state with the new mode
    const sel = useEditorStore.getState().selection;
    if (sel.active && sel.bounds) {
      setTransform(createTransformState(sel.bounds, mode));
    }
  };

  const handleFlip = (axis: 'horizontal' | 'vertical') => {
    if (isLayerBox) {
      applyLayerTransformStep((t) => flipTransform(t, axis));
      return;
    }
    applyGpuTransform(axis === 'horizontal'
      ? new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1])
      : new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]));
  };

  return (
    <div className={styles.container}>
      <div className={styles.group}>
        <IconButton
          icon={<FlipHorizontal2 size={16} />}
          label="Flip Horizontal"
          onClick={() => handleFlip('horizontal')}
        />
        <IconButton
          icon={<FlipVertical2 size={16} />}
          label="Flip Vertical"
          onClick={() => handleFlip('vertical')}
        />
      </div>
      {showsTextModes && (
        <div className={styles.modeGroup}>
          {TEXT_MODES.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.modeButton} ${textMode === id ? styles.active : ''}`}
              onClick={() => setTextMode(id)}
              type="button"
              aria-pressed={textMode === id}
              aria-label={`Transform mode: ${label}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(transform || isLayerBox) && !showsTextModes && (
        <div className={styles.modeGroup}>
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.modeButton} ${currentMode === id ? styles.active : ''}`}
              onClick={() => handleModeChange(id)}
              type="button"
              aria-pressed={currentMode === id}
              aria-label={`Transform mode: ${label}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
