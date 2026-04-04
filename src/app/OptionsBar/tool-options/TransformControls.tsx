import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import { FlipHorizontal2, FlipVertical2, RotateCw, RotateCcw } from 'lucide-react';
import { flipHorizontal, flipVertical, rotate90CW, rotate90CCW } from '../../../tools/transform/transform-actions';
import type { TransformMode } from '../../../tools/transform/transform';
import styles from './TransformControls.module.css';

function applyPixelTransform(
  fn: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    selectionMask: Uint8ClampedArray | null,
    maskWidth: number,
    maskHeight: number,
    bounds: { x: number; y: number; width: number; height: number },
    layerX: number,
    layerY: number,
  ) => void,
): void {
  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  if (!sel.active || !sel.bounds || !sel.mask) return;

  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;
  const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
  if (!activeLayer) return;

  editorState.pushHistory();
  const imageData = editorState.expandLayerForEditing(activeLayerId);
  fn(
    imageData.data,
    imageData.width,
    imageData.height,
    sel.mask,
    sel.maskWidth,
    sel.maskHeight,
    sel.bounds,
    activeLayer.x,
    activeLayer.y,
  );
  editorState.updateLayerPixelData(activeLayerId, imageData);
  editorState.cropLayerToContent(activeLayerId);
  editorState.notifyRender();
}

function applyRotateTransform(
  fn: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    bounds: { x: number; y: number; width: number; height: number },
    layerX: number,
    layerY: number,
  ) => void,
): void {
  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  if (!sel.active || !sel.bounds) return;

  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;
  const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
  if (!activeLayer) return;

  editorState.pushHistory();
  const imageData = editorState.expandLayerForEditing(activeLayerId);
  fn(
    imageData.data,
    imageData.width,
    imageData.height,
    sel.bounds,
    activeLayer.x,
    activeLayer.y,
  );
  editorState.updateLayerPixelData(activeLayerId, imageData);
  editorState.cropLayerToContent(activeLayerId);
  editorState.notifyRender();
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
    if (transform) {
      setTransform({ ...transform, mode });
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.group}>
        <IconButton
          icon={<FlipHorizontal2 size={16} />}
          label="Flip Horizontal"
          onClick={() => applyPixelTransform(flipHorizontal)}
        />
        <IconButton
          icon={<FlipVertical2 size={16} />}
          label="Flip Vertical"
          onClick={() => applyPixelTransform(flipVertical)}
        />
        <IconButton
          icon={<RotateCw size={16} />}
          label="Rotate 90° CW"
          onClick={() => applyRotateTransform(rotate90CW)}
        />
        <IconButton
          icon={<RotateCcw size={16} />}
          label="Rotate 90° CCW"
          onClick={() => applyRotateTransform(rotate90CCW)}
        />
      </div>
      {transform && (
        <div className={styles.modeGroup}>
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.modeButton} ${currentMode === id ? styles.active : ''}`}
              onClick={() => handleModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
