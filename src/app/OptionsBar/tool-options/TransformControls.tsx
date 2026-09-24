import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import type { TransformMode, TransformState } from '../../../tools/transform/transform';
import { createTransformState, computeInverseAffineMatrix } from '../../../tools/transform/transform';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloatAffine,
  dropFloat,
  hasFloat,
} from '../../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../../panels/LayerPanel/layer-selection';
import styles from './TransformControls.module.css';

function isIdentityTransform(t: TransformState): boolean {
  return (
    t.scaleX === 1 &&
    t.scaleY === 1 &&
    t.rotation === 0 &&
    t.translateX === 0 &&
    t.translateY === 0 &&
    t.skewX === 0 &&
    t.skewY === 0 &&
    t.corners.every((c) => c.x === 0 && c.y === 0)
  );
}

/**
 * Apply an instant GPU transform (flip/rotate) to the selected content:
 * 1. Float the selection on GPU
 * 2. Render with the given inverse matrix
 * 3. Drop float (commits to layer texture)
 * 4. Re-select from committed alpha (rebuilds mask cleanly)
 *
 * `flipDirection` — when supplied, and there is a pending Move-tool transform
 * that has not yet been committed, the flip composes into that pending
 * transform in place (Photoshop behaviour). Otherwise the raw `invMatrix`
 * is used and the operation commits immediately. #800 — a bare
 * `compositeFloatAffine(flip, cx, cx)` threw away the pending scale /
 * rotation because it re-rendered the base float without carrying the
 * pending transform through.
 */
export function applyGpuTransform(
  invMatrix: Float32Array,
  flipDirection?: 'horizontal' | 'vertical',
): void {
  const engine = getEngine();
  if (!engine) return;

  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  if (!sel.active || !sel.bounds || !sel.mask) return;

  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;

  const uiTransform = useUIStore.getState().transform;
  const hasPendingTransform = !!(
    flipDirection &&
    uiTransform &&
    uiTransform.mode === 'free' &&
    !isIdentityTransform(uiTransform) &&
    hasFloat(engine)
  );

  if (hasPendingTransform && uiTransform) {
    // Compose the flip into the pending transform state and re-composite
    // the float. The pending float already carries the base pixels; the
    // affine shader re-renders them at the composed transform every time
    // we call compositeFloatAffine, so we do NOT drop the float. The user
    // can keep dragging handles, or ⌘D / Enter to commit.
    const composed: TransformState = {
      ...uiTransform,
      scaleX: flipDirection === 'horizontal' ? -uiTransform.scaleX : uiTransform.scaleX,
      scaleY: flipDirection === 'vertical' ? -uiTransform.scaleY : uiTransform.scaleY,
    };
    const ob = composed.originalBounds;
    const srcCx = ob.x + ob.width / 2;
    const srcCy = ob.y + ob.height / 2;
    const dstCx = srcCx + composed.translateX;
    const dstCy = srcCy + composed.translateY;
    const composedInv = computeInverseAffineMatrix(composed);
    compositeFloatAffine(engine, composedInv, srcCx, srcCy, dstCx, dstCy);
    useUIStore.getState().setTransform(composed);
    editorState.notifyRender();
    return;
  }

  editorState.pushHistory('Transform');

  // Float if needed
  if (!hasFloat(engine)) {
    const floatBounds = floatSelection(engine, activeLayerId);
    if (floatBounds.length >= 4) {
      const newX = floatBounds[0]!;
      const newY = floatBounds[1]!;
      const newW = floatBounds[2]!;
      const newH = floatBounds[3]!;
      const curLayer = editorState.document.layers.find(l => l.id === activeLayerId);
      if (curLayer) {
        const posChanged = curLayer.x !== newX || curLayer.y !== newY;
        const sizeChanged = curLayer.type === 'raster'
          && (curLayer.width !== newW || curLayer.height !== newH);
        if (posChanged || sizeChanged) {
          useEditorStore.setState((s) => ({
            document: {
              ...s.document,
              layers: s.document.layers.map((l) =>
                l.id === activeLayerId
                  ? {
                    ...l,
                    x: newX,
                    y: newY,
                    ...(l.type === 'raster' ? { width: newW, height: newH } : {}),
                  }
                  : l
              ),
            },
          }));
        }
      }
    }
  }

  // Apply transform centered on selection bounds
  const cx = sel.bounds.x + sel.bounds.width / 2;
  const cy = sel.bounds.y + sel.bounds.height / 2;
  compositeFloatAffine(engine, invMatrix, cx, cy, cx, cy);

  // Drop float — layer texture now has the committed result
  dropFloat(engine);

  // Re-select from committed pixel alpha (handles JS data clearing + mask rebuild)
  selectLayerAlpha(activeLayerId);
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

export function TransformControls() {
  const selectionActive = useEditorStore((s) => s.selection.active);
  const transform = useUIStore((s) => s.transform);
  const setTransform = useUIStore((s) => s.setTransform);

  if (!selectionActive) return null;

  const currentMode = transform?.mode ?? 'free';

  const handleModeChange = (mode: TransformMode) => {
    if (!transform) return;
    // Commit any active transform before switching modes
    const engine = getEngine();
    if (engine && hasFloat(engine)) {
      const activeLayerId = useEditorStore.getState().document.activeLayerId;
      if (activeLayerId) {
        selectLayerAlpha(activeLayerId);
      }
    }
    // Create fresh transform state with the new mode
    const sel = useEditorStore.getState().selection;
    if (sel.active && sel.bounds) {
      setTransform(createTransformState(sel.bounds, mode));
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.group}>
        <IconButton
          icon={<FlipHorizontal2 size={16} />}
          label="Flip Horizontal"
          onClick={() => applyGpuTransform(new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1]), 'horizontal')}
        />
        <IconButton
          icon={<FlipVertical2 size={16} />}
          label="Flip Vertical"
          onClick={() => applyGpuTransform(new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]), 'vertical')}
        />
      </div>
      {transform && (
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
