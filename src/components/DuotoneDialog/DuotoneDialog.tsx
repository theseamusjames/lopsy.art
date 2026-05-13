import { useState, useCallback, useEffect, useRef } from 'react';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import type { Color } from '../../types';
import styles from './DuotoneDialog.module.css';

interface DuotoneDialogProps {
  onApply: (values: Record<string, number>) => void;
  onCancel: () => void;
  onPreviewChange?: (values: Record<string, number>) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

const PRESETS: { label: string; shadow: Color; highlight: Color }[] = [
  { label: 'Midnight Gold', shadow: { r: 10, g: 15, b: 50, a: 1 }, highlight: { r: 255, g: 200, b: 50, a: 1 } },
  { label: 'Cyan & Pink', shadow: { r: 0, g: 40, b: 80, a: 1 }, highlight: { r: 255, g: 120, b: 180, a: 1 } },
  { label: 'Classic Blue', shadow: { r: 0, g: 20, b: 60, a: 1 }, highlight: { r: 200, g: 220, b: 255, a: 1 } },
  { label: 'Sepia', shadow: { r: 40, g: 20, b: 10, a: 1 }, highlight: { r: 240, g: 210, b: 170, a: 1 } },
  { label: 'Emerald', shadow: { r: 5, g: 30, b: 20, a: 1 }, highlight: { r: 160, g: 255, b: 180, a: 1 } },
  { label: 'Infrared', shadow: { r: 10, g: 0, b: 30, a: 1 }, highlight: { r: 255, g: 60, b: 60, a: 1 } },
];

function colorToValues(shadow: Color, highlight: Color, contrast: number): Record<string, number> {
  return {
    shadowR: shadow.r,
    shadowG: shadow.g,
    shadowB: shadow.b,
    highlightR: highlight.r,
    highlightG: highlight.g,
    highlightB: highlight.b,
    contrast,
  };
}

export function DuotoneDialog({ onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: DuotoneDialogProps) {
  const [shadowColor, setShadowColor] = useState<Color>({ r: 10, g: 15, b: 50, a: 1 });
  const [highlightColor, setHighlightColor] = useState<Color>({ r: 255, g: 200, b: 50, a: 1 });
  const [contrast, setContrast] = useState(1.0);
  const [preview, setPreview] = useState(false);
  const previewActiveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { offset, dragProps } = useDraggablePanel();

  const currentValues = colorToValues(shadowColor, highlightColor, contrast);

  useEffect(() => {
    if (!preview || !onPreviewChange) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(currentValues);
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [shadowColor, highlightColor, contrast, preview, onPreviewChange, currentValues]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange) {
          setTimeout(() => onPreviewChange(currentValues), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, currentValues]);

  const handleApply = useCallback(() => {
    onApply(currentValues);
  }, [onApply, currentValues]);

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

  const handlePreset = useCallback((preset: typeof PRESETS[number]) => {
    setShadowColor(preset.shadow);
    setHighlightColor(preset.highlight);
  }, []);

  return (
    <div className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Duotone"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <div className={styles.header} {...dragProps}>
          <h2>Duotone</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.presetRow}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={styles.presetSwatch}
                onClick={() => handlePreset(preset)}
                type="button"
                title={preset.label}
                aria-label={preset.label}
              >
                <div
                  className={styles.presetGradient}
                  style={{
                    background: `linear-gradient(to right, rgb(${preset.shadow.r},${preset.shadow.g},${preset.shadow.b}), rgb(${preset.highlight.r},${preset.highlight.g},${preset.highlight.b}))`,
                  }}
                />
              </button>
            ))}
          </div>
          <div className={styles.colorSection}>
            <span className={styles.colorLabel}>Shadows</span>
            <ColorPicker color={shadowColor} onChange={setShadowColor} compact />
          </div>
          <div className={styles.colorSection}>
            <span className={styles.colorLabel}>Highlights</span>
            <ColorPicker color={highlightColor} onChange={setHighlightColor} compact />
          </div>
          <Slider
            label="Contrast"
            value={contrast}
            min={0.5}
            max={3.0}
            step={0.05}
            onChange={setContrast}
          />
        </div>
        <div className={styles.footer}>
          <label className={styles.previewLabel}>
            <input
              type="checkbox"
              checked={preview}
              onChange={handlePreviewToggle}
              className={styles.previewCheckbox}
            />
            Preview
          </label>
          <div className={styles.footerButtons}>
            <button className={styles.cancelButton} onClick={handleCancel} type="button">
              Cancel
            </button>
            <button className={styles.applyButton} onClick={handleApply} type="button">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
