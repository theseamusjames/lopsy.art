import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import type { TransformMode } from '../../../tools/transform/transform';
import { createTransformState } from '../../../tools/transform/transform';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloatAffine,
  dropFloat,
  hasFloat,
} from '../../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../../panels/LayerPanel/layer-selection';
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

  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  if (!sel.active || !sel.bounds || !sel.mask) return;

  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;

  editorState.pushHistory();

  // Float if needed
  if (!hasFloat(engine)) {
    floatSelection(engine, activeLayerId);
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
          onClick={() => applyGpuTransform(new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1]))}
        />
        <IconButton
          icon={<FlipVertical2 size={16} />}
          label="Flip Vertical"
          onClick={() => applyGpuTransform(new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]))}
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
