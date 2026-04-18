import { useState, useCallback, useEffect, useRef } from 'react';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { rasterizePathToLayer } from '../../app/interactions/path-stroke';
import { colorToCSS } from '../../utils/color';
import styles from './StrokePathModal.module.css';

export function StrokePathModal() {
  const strokeModalPathId = useUIStore((s) => (s.modal?.kind === 'strokePath' ? s.modal.pathId : null));
  const setStrokeModalPathId = useUIStore((s) => s.setStrokeModalPathId);
  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const defaultWidth = useToolSettingsStore((s) => s.pathStrokeWidth);

  const [width, setWidth] = useState('');
  const widthRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (strokeModalPathId) {
      setWidth(String(defaultWidth));
      requestAnimationFrame(() => widthRef.current?.select());
    }
  }, [strokeModalPathId, defaultWidth]);

  const handleConfirm = useCallback(() => {
    if (!strokeModalPathId) return;
    const editorState = useEditorStore.getState();
    const path = editorState.paths.find((p) => p.id === strokeModalPathId);
    const activeId = editorState.document.activeLayerId;
    if (!path || !activeId) return;

    const strokeWidth = Math.max(1, Math.min(50, Math.round(parseFloat(width) || 1)));
    rasterizePathToLayer(path.anchors, path.closed, activeId, strokeWidth, foregroundColor);
    setStrokeModalPathId(null);
  }, [strokeModalPathId, width, foregroundColor, setStrokeModalPathId]);

  const handleCancel = useCallback(() => {
    setStrokeModalPathId(null);
  }, [setStrokeModalPathId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleConfirm, handleCancel]);

  if (!strokeModalPathId) return null;

  const swatchStyle = { backgroundColor: colorToCSS(foregroundColor) };

  return (
    <div className={styles.overlay} onMouseDown={handleCancel}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Stroke Path</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Width</label>
            <div className={styles.fieldRow}>
              <input
                ref={widthRef}
                className={styles.fieldInput}
                type="number"
                min="1"
                max="50"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
              <span className={styles.unit}>px</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Color</label>
            <div className={styles.fieldRow}>
              <div className={styles.swatch} style={swatchStyle} />
              <span className={styles.unit}>Foreground</span>
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleCancel}>Cancel</button>
          <button className={styles.confirmButton} onClick={handleConfirm}>Stroke</button>
        </div>
      </div>
    </div>
  );
}
