import { useState, useCallback } from 'react';
import { Slider } from '../Slider/Slider';
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
}

export type { FilterParam, FilterDialogProps };

export function FilterDialog({ title, params, onApply, onCancel }: FilterDialogProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const param of params) {
      initial[param.key] = param.defaultValue;
    }
    return initial;
  });

  const handleChange = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    onApply(values);
  }, [onApply, values]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleApply, onCancel]);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} onKeyDown={handleKeyDown}>
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
          <button className={styles.cancelButton} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.applyButton} onClick={handleApply} type="button">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
