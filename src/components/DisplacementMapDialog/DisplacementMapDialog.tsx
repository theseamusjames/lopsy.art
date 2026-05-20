import { useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useEditorStore } from '../../app/editor-store';
import styles from './DisplacementMapDialog.module.css';

interface DisplacementMapDialogProps {
  onApply: (sourceLayerId: string, scaleX: number, scaleY: number, edgeMode: number) => void;
  onCancel: () => void;
  onPreviewChange?: (sourceLayerId: string, scaleX: number, scaleY: number, edgeMode: number) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

const EDGE_MODES = [
  { value: 0, label: 'Transparent' },
  { value: 1, label: 'Clamp' },
  { value: 2, label: 'Wrap' },
];

export function DisplacementMapDialog({
  onApply,
  onCancel,
  onPreviewChange,
  onPreviewStart,
  onPreviewStop,
}: DisplacementMapDialogProps) {
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);

  const otherLayers = layers.filter(
    (l) => l.id !== activeLayerId && l.type !== 'group' && l.visible,
  );

  const [sourceLayerId, setSourceLayerId] = useState<string>(() => otherLayers[0]?.id ?? '');
  const [scaleX, setScaleX] = useState(20);
  const [scaleY, setScaleY] = useState(20);
  const [edgeMode, setEdgeMode] = useState(0);
  const [preview, setPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);

  useEffect(() => {
    if (!preview || !onPreviewChange || !sourceLayerId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(sourceLayerId, scaleX, scaleY, edgeMode);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sourceLayerId, scaleX, scaleY, edgeMode, preview, onPreviewChange]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange && sourceLayerId) {
          setTimeout(() => onPreviewChange(sourceLayerId, scaleX, scaleY, edgeMode), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, sourceLayerId, scaleX, scaleY, edgeMode]);

  const handleApply = useCallback(() => {
    if (!sourceLayerId) return;
    onApply(sourceLayerId, scaleX, scaleY, edgeMode);
  }, [onApply, sourceLayerId, scaleX, scaleY, edgeMode]);

  const handleCancel = useCallback(() => {
    if (previewActiveRef.current) {
      onPreviewStop?.();
    }
    onCancel();
  }, [onCancel, onPreviewStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleApply, handleCancel],
  );

  const { offset, dragProps } = useDraggablePanel();

  return (
    <div
      className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`}
      role="presentation"
    >
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
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="disp-source">
              Source Layer
            </label>
            <select
              id="disp-source"
              className={styles.select}
              value={sourceLayerId}
              onChange={(e) => setSourceLayerId(e.target.value)}
            >
              {otherLayers.length === 0 && (
                <option value="" disabled>
                  No other layers available
                </option>
              )}
              {otherLayers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <Slider
            label="Horizontal Scale"
            value={scaleX}
            min={0}
            max={200}
            step={1}
            onChange={setScaleX}
          />
          <Slider
            label="Vertical Scale"
            value={scaleY}
            min={0}
            max={200}
            step={1}
            onChange={setScaleY}
          />
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="disp-edge">
              Edge Mode
            </label>
            <select
              id="disp-edge"
              className={styles.select}
              value={edgeMode}
              onChange={(e) => setEdgeMode(Number(e.target.value))}
            >
              {EDGE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
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
                disabled={otherLayers.length === 0}
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
              disabled={otherLayers.length === 0}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
