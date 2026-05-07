import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax } from '../../utils/slider-ranges';
import styles from './FilterDialog.module.css';

interface FilterParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  /** When 'doc', max scales to 1.5x max(docW, docH) capped at 5000, with `max` as the floor. */
  dynamicMax?: 'doc';
}

interface FilterDialogProps {
  title: string;
  params: FilterParam[];
  showRegenerate?: boolean;
  onApply: (values: Record<string, number>) => void;
  onCancel: () => void;
  onPreviewChange?: (values: Record<string, number>) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

export type { FilterParam, FilterDialogProps };

export function FilterDialog({ title, params, showRegenerate, onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: FilterDialogProps) {
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

  const handleRegenerate = useCallback(() => {
    if (!preview) {
      setPreview(true);
      previewActiveRef.current = true;
      onPreviewStart?.();
    }
    if (onPreviewChange) {
      setTimeout(() => onPreviewChange(values), 0);
    }
  }, [preview, onPreviewStart, onPreviewChange, values]);

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
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  return (
    <div className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label={title}
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <div className={styles.header} {...dragProps}>
          <h2>{title}</h2>
        </div>
        <div className={styles.body}>
          {params.map((param) => {
            const max = param.dynamicMax === 'doc'
              ? docScaledMax(docWidth, docHeight, param.max)
              : param.max;
            return (
              <div key={param.key} className={styles.paramRow}>
                <Slider
                  label={param.label}
                  value={values[param.key] ?? param.defaultValue}
                  min={param.min}
                  max={max}
                  step={param.step ?? 1}
                  onChange={(v) => handleChange(param.key, v)}
                />
              </div>
            );
          })}
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
            {showRegenerate && (
              <button
                className={styles.regenerateButton}
                onClick={handleRegenerate}
                type="button"
                title="Regenerate"
                aria-label="Regenerate"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
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
