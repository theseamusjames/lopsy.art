import { useId } from 'react';
import { Pipette } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { choiceChanges, currentChoice, type WhiteBalanceChoice, type WhiteBalancePreset, type WhiteBalanceValues } from './white-balance-mode';
import styles from './WhiteBalanceMenu.module.css';

export interface WhiteBalanceMenuProps {
  readonly recipe: Recipe;
  /** Auto's values, when the photo has them (RAW files). */
  readonly auto: WhiteBalanceValues | null;
  /** The camera's presets, when the engine gives them. */
  readonly presets: readonly WhiteBalancePreset[];
  readonly isDisabled: boolean;
  readonly onCommit: (changes: Readonly<Record<string, Json>>, label: string) => void;
  /** Whether the picker is waiting for a click on the photo. */
  readonly isPicking: boolean;
  readonly onTogglePicker: () => void;
}

/** White balance mode: As shot, Auto, presets, or Custom (what the sliders set). */
export function WhiteBalanceMenu({ recipe, auto, presets, isDisabled, onCommit, isPicking, onTogglePicker }: WhiteBalanceMenuProps) {
  const choice = currentChoice(recipe, auto, presets);
  const pickerHintId = useId();
  return (
    <div className={styles.row}>
      <span className={styles.title}>Mode</span>
      <select
        className={styles.select}
        aria-label="White balance mode"
        value={choice}
        disabled={isDisabled}
        onChange={(e) => {
          const next = choiceChanges(e.currentTarget.value as WhiteBalanceChoice, auto, presets);
          if (next) onCommit(next.changes, next.label);
        }}
      >
        <option value="asShot">As shot</option>
        {auto && <option value="auto">Auto</option>}
        {presets.map((p) => (
          <option key={p.id} value={`preset:${p.id}`}>
            {p.name}
          </option>
        ))}
        <option value="custom" disabled={choice !== 'custom'}>
          Custom
        </option>
      </select>
      <button
        type="button"
        className={styles.picker}
        aria-label="Pick a neutral grey"
        aria-describedby={pickerHintId}
        title="Click something in the photo that should be neutral grey (Esc cancels)"
        aria-pressed={isPicking}
        disabled={isDisabled}
        onClick={(e) => {
          e.preventDefault();
          onTogglePicker();
        }}
      >
        <Pipette size={14} aria-hidden />
      </button>
      <span id={pickerHintId} className={styles.srOnly}>
        Then click something in the photo that should be neutral grey; Escape cancels. The Temperature and Tint sliders set the white balance without it.
      </span>
    </div>
  );
}
