import { useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useEditorStore } from '../../app/editor-store';
import styles from './DisplacementMapDialog.module.css';

interface DisplacementMapDialogProps {
  onApply: (dispLayerId: string, scaleX: number, scaleY: number, mode: number, wrap: number) => void;
  onCancel: () => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
  onPreviewChange?: (dispLayerId: string, scaleX: number, scaleY: number, mode: number, wrap: number) => void;
}

export function DisplacementMapDialog({
  onApply,
  onCancel,
  onPreviewStart,
  onPreviewStop,
  onPreviewChange,
}: DisplacementMapDialogProps) {
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);

  const eligibleLayers = layers.filter(
    (l) => l.type !== 'group' && l.id !== activeLayerId,
  );

  const [dispLayerId, setDispLayerId] = useState(eligibleLayers[0]?.id ?? '');
  const [scaleX, setScaleX] = useState(20);
  const [scaleY, setScaleY] = useState(20);
  const [mode, setMode] = useState(0);
  const [wrap, setWrap] = useState(0);
  const [preview, setPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);

  useEffect(() => {
    if (!preview || !onPreviewChange || !dispLayerId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(dispLayerId, scaleX, scaleY, mode, wrap);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dispLayerId, scaleX, scaleY, mode, wrap, preview, onPreviewChange]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange && dispLayerId) {
          setTimeout(() => onPreviewChange(dispLayerId, scaleX, scaleY, mode, wrap), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, dispLayerId, scaleX, scaleY, mode, wrap]);

  const handleApply = useCallback(() => {
    if (!dispLayerId) return;
    onApply(dispLayerId, scaleX, scaleY, mode, wrap);
  }, [onApply, dispLayerId, scaleX, scaleY, mode, wrap]);

  const handleCancel = useCallback(() => {
    if (previewActiveRef.current) {
      onPreviewStop?.();
    }
    onCancel();
  }, [onCancel, onPreviewStop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleApply, handleCancel]);

  const { offset, dragProps } = useDraggablePanel();

  return (
    <div className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Displacement Map"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <div className={styles.header} {...dragProps}>
          <h2>Displacement Map</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Source Layer</label>
            <select
              className={styles.select}
              value={dispLayerId}
              onChange={(e) => setDispLayerId(e.target.value)}
            >
              {eligibleLayers.length === 0 && (
                <option value="">No eligible layers</option>
              )}
              {eligibleLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <Slider
              label="Horizontal Scale"
              value={scaleX}
              min={-200}
              max={200}
              step={1}
              onChange={setScaleX}
            />
          </div>
          <div className={styles.fieldRow}>
            <Slider
              label="Vertical Scale"
              value={scaleY}
              min={-200}
              max={200}
              step={1}
              onChange={setScaleY}
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Channel Mode</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="dispMode"
                  checked={mode === 0}
                  onChange={() => setMode(0)}
                />
                Red / Green
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="dispMode"
                  checked={mode === 1}
                  onChange={() => setMode(1)}
                />
                Luminance
              </label>
            </div>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Edge Behavior</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="dispWrap"
                  checked={wrap === 0}
                  onChange={() => setWrap(0)}
                />
                Transparent
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="dispWrap"
                  checked={wrap === 1}
                  onChange={() => setWrap(1)}
                />
                Tile
              </label>
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <label className={styles.previewLabel}>
              <input
                type="checkbox"
                checked={preview}
                onChange={handlePreviewToggle}
                className={styles.previewCheckbox}
              />
              Preview
            </label>
          </div>
          <div className={styles.footerButtons}>
            <button className={styles.cancelButton} onClick={handleCancel} type="button">
              Cancel
            </button>
            <button
              className={styles.applyButton}
              onClick={handleApply}
              type="button"
              disabled={!dispLayerId}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
