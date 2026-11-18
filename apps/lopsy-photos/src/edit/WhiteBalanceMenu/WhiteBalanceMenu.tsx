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
}

/** White balance mode: As shot, Auto, presets, or Custom (what the sliders set). */
export function WhiteBalanceMenu({ recipe, auto, presets, isDisabled, onCommit }: WhiteBalanceMenuProps) {
  const choice = currentChoice(recipe, auto, presets);
  return (
    <label className={styles.row}>
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
    </label>
  );
}
