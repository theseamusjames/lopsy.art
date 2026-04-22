import { useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { usePatternStore } from '../../app/pattern-store';
import type { PatternDefinition } from '../../app/pattern-store';
import styles from './PatternFillDialog.module.css';

interface PatternFillDialogProps {
  onApply: (patternId: string, scale: number, offsetX: number, offsetY: number) => void;
  onCancel: () => void;
  onPreviewChange?: (patternId: string, scale: number, offsetX: number, offsetY: number) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

export type { PatternFillDialogProps };

export function PatternFillDialog({ onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: PatternFillDialogProps) {
  const patterns = usePatternStore((s) => s.patterns);
  const activePatternId = usePatternStore((s) => s.activePatternId);
  const setActivePattern = usePatternStore((s) => s.setActivePattern);

  const [selectedId, setSelectedId] = useState<string | null>(activePatternId);
  const [scale, setScale] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [preview, setPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);

  const handleSelectPattern = useCallback((id: string) => {
    setSelectedId(id);
    setActivePattern(id);
  }, [setActivePattern]);

  useEffect(() => {
    if (!preview || !onPreviewChange || !selectedId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(selectedId, scale, offsetX, offsetY);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedId, scale, offsetX, offsetY, preview, onPreviewChange]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange && selectedId) {
          setTimeout(() => onPreviewChange(selectedId, scale, offsetX, offsetY), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, selectedId, scale, offsetX, offsetY]);

  const handleApply = useCallback(() => {
    if (!selectedId) return;
    onApply(selectedId, scale, offsetX, offsetY);
  }, [onApply, selectedId, scale, offsetX, offsetY]);

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

  const selectedPattern: PatternDefinition | undefined = patterns.find((p) => p.id === selectedId);

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Pattern Fill"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>Pattern Fill</h2>
        </div>
        <div className={styles.body}>
          {patterns.length === 0 ? (
            <p className={styles.emptyMessage}>
              No patterns defined. Use Edit &gt; Define Pattern to capture the active layer as a pattern.
            </p>
          ) : (
            <>
              <div className={styles.patternGrid}>
                {patterns.map((p) => (
                  <button
                    key={p.id}
                    className={`${styles.patternSwatch} ${selectedId === p.id ? styles.patternSwatchSelected : ''}`}
                    onClick={() => handleSelectPattern(p.id)}
                    type="button"
                    title={`${p.name} (${p.width}×${p.height})`}
                  >
                    <img src={p.thumbnail} alt={p.name} className={styles.patternThumbnail} />
                  </button>
                ))}
              </div>
              {selectedPattern && (
                <div className={styles.patternInfo}>
                  {selectedPattern.name} — {selectedPattern.width}×{selectedPattern.height}
                </div>
              )}
              <Slider
                label="Scale"
                value={scale}
                min={10}
                max={1000}
                step={1}
                onChange={setScale}
              />
              <Slider
                label="Offset X"
                value={offsetX}
                min={0}
                max={100}
                step={1}
                onChange={setOffsetX}
              />
              <Slider
                label="Offset Y"
                value={offsetY}
                min={0}
                max={100}
                step={1}
                onChange={setOffsetY}
              />
            </>
          )}
        </div>
        <div className={styles.footer}>
          <label className={styles.previewLabel}>
            <input
              type="checkbox"
              checked={preview}
              onChange={handlePreviewToggle}
              className={styles.previewCheckbox}
              disabled={patterns.length === 0 || !selectedId}
            />
            Preview
          </label>
          <div className={styles.footerButtons}>
            <button className={styles.cancelButton} onClick={handleCancel} type="button">
              Cancel
            </button>
            <button
              className={styles.applyButton}
              onClick={handleApply}
              type="button"
              disabled={!selectedId}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
