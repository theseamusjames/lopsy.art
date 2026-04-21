import { useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import styles from './FilterDialog.module.css';

interface FilterParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
}

interface FilterDialogProps {
  title: string;
  params: FilterParam[];
  onApply: (values: Record<string, number>) => void;
  onCancel: () => void;
  onPreviewChange?: (values: Record<string, number>) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

export type { FilterParam, FilterDialogProps };

export function FilterDialog({ title, params, onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: FilterDialogProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const param of params) {
      initial[param.key] = param.defaultValue;
    }
    return initial;
  });
  const [preview, setPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);

  const handleChange = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Debounced preview update when values change and preview is enabled
  useEffect(() => {
    if (!preview || !onPreviewChange) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(values);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [values, preview, onPreviewChange]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        // Trigger immediate preview with current values
        if (onPreviewChange) {
          setTimeout(() => onPreviewChange(values), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, values]);

  const handleApply = useCallback(() => {
    onApply(values);
  }, [onApply, values]);

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
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label={title}
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>{title}</h2>
        </div>
        <div className={styles.body}>
          {params.map((param) => (
            <div key={param.key} className={styles.paramRow}>
              <Slider
                label={param.label}
                value={values[param.key] ?? param.defaultValue}
                min={param.min}
                max={param.max}
                step={param.step ?? 1}
                onChange={(v) => handleChange(param.key, v)}
              />
            </div>
          ))}
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
