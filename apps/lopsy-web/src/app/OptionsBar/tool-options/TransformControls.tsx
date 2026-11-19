import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import type { TransformMode } from '../../../tools/transform/transform';
import type { TextTransformMode } from '../../ui-store';
import { createTransformState } from '../../../tools/transform/transform';
import { commitLiveFloat } from '../../interactions/live-float';
import { flipFromMoveOptions, wantsLayerTransform } from '../../interactions/move-transform-buttons';
import styles from './TransformControls.module.css';

const MODES: { id: TransformMode; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'skew', label: 'Skew' },
  { id: 'distort', label: 'Distort' },
  { id: 'perspective', label: 'Perspective' },
];

/** Whether the Move tool frames the selected layers (no marquee, several layers or a group). */
function useWantsLayerTransform(): boolean {
  const selectionActive = useEditorStore((s) => s.selection.active);
  const layers = useEditorStore((s) => s.document.layers);
  const selectedIds = useEditorStore((s) => s.document.selectedLayerIds);
  return wantsLayerTransform(selectionActive, layers, selectedIds ?? []);
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
    void flipFromMoveOptions(axis, isLayerBox);
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
