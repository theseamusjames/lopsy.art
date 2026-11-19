import { X } from 'lucide-react';
import type { ColorLabel } from '@lopsy/photos-core/library/types';
import { handleRadioKeys, radioTabIndex } from '../RadioGroup/radio-keys';
import styles from './LabelPicker.module.css';

export const LABEL_NAMES: Readonly<Record<ColorLabel, string>> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

const LABELS: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];
/** The radios in order: the five labels, then none. */
const CHOICES: readonly (ColorLabel | null)[] = [...LABELS, null];

interface LabelPickerProps {
  /** undefined: photos with different labels (nothing is marked). */
  value: ColorLabel | null | undefined;
  onChange: (label: ColorLabel | null) => void;
}

/**
 * The five colour labels and "none", as a radio group: one Tab stop, the
 * arrow keys choose. Each swatch says its colour in words, as its name
 * and in its tooltip.
 */
export function LabelPicker({ value, onChange }: LabelPickerProps) {
  const checked = value === undefined ? -1 : CHOICES.indexOf(value);
  return (
    <span
      className={styles.picker}
      role="radiogroup"
      aria-label="Colour label"
      onKeyDown={(e) =>
        handleRadioKeys(e, (index) => {
          const choice = CHOICES[index];
          if (choice !== undefined) onChange(choice);
        })
      }
    >
      {LABELS.map((label, index) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value === label}
          aria-label={`${LABEL_NAMES[label]} label`}
          title={`${LABEL_NAMES[label]} label (${label[0]?.toUpperCase()})`}
          tabIndex={radioTabIndex(index, checked)}
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
        tabIndex={radioTabIndex(LABELS.length, checked)}
        className={styles.none}
        onClick={() => onChange(null)}
      >
        <X size={12} />
      </button>
    </span>
  );
}
