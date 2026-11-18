import { X } from 'lucide-react';
import type { ColorLabel } from '@lopsy/photos-core/library/types';
import styles from './LabelPicker.module.css';

export const LABEL_NAMES: Readonly<Record<ColorLabel, string>> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

const LABELS: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];

interface LabelPickerProps {
  /** undefined: photos with different labels (nothing is marked). */
  value: ColorLabel | null | undefined;
  onChange: (label: ColorLabel | null) => void;
}

/** The five colour labels and "none". */
export function LabelPicker({ value, onChange }: LabelPickerProps) {
  return (
    <span className={styles.picker} role="radiogroup" aria-label="Colour label">
      {LABELS.map((label) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value === label}
          aria-label={LABEL_NAMES[label]}
          title={`${LABEL_NAMES[label]} (${label[0]?.toUpperCase()})`}
          className={styles.swatch}
          data-label={label}
          onClick={() => onChange(value === label ? null : label)}
        />
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="No label"
        title="No label"
        className={styles.none}
        onClick={() => onChange(null)}
      >
        <X size={12} />
      </button>
    </span>
  );
}
