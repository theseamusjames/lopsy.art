import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { usePatternStore } from '../../app/pattern-store';
import type { PatternDefinition, PatternFillSettings } from '../../app/pattern-store';
import styles from './PatternFillDialog.module.css';

interface PatternFillDialogProps {
  onApply: (patternId: string, settings: PatternFillSettings) => void;
  onCancel: () => void;
  onPreviewChange?: (patternId: string, settings: PatternFillSettings) => void;
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
  const [rowStagger, setRowStagger] = useState(0);
  const [columnStagger, setColumnStagger] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const settings = useMemo<PatternFillSettings>(
    () => ({ scale, rowStagger, columnStagger, offsetX, offsetY }),
    [scale, rowStagger, columnStagger, offsetX, offsetY],
  );
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
      onPreviewChange(selectedId, settings);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedId, settings, preview, onPreviewChange]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange && selectedId) {
          setTimeout(() => onPreviewChange(selectedId, settings), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, selectedId, settings]);

  const handleApply = useCallback(() => {
    if (!selectedId) return;
    onApply(selectedId, settings);
  }, [onApply, selectedId, settings]);

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
    <div className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Pattern Fill"
        onKeyDown={handleKeyDown}
        style={{ '--drag-x': `${offset.x}px`, '--drag-y': `${offset.y}px` } as React.CSSProperties}
      >
        <div className={styles.header} {...dragProps}>
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
                label="Row Stagger"
                value={rowStagger}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={setRowStagger}
              />
              <Slider
                label="Column Stagger"
                value={columnStagger}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={setColumnStagger}
              />
              <Slider
                label="Horizontal Offset"
                value={offsetX}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={setOffsetX}
              />
              <Slider
                label="Vertical Offset"
                value={offsetY}
                min={0}
                max={100}
                step={1}
                suffix="%"
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
