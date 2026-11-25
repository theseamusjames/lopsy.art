import type { BlendMode } from '../../types';
import { BLEND_MODE_TO_DISPLAY } from '../../types/blend-mode-tables';
import { blendModeGroupsFor } from './blend-mode-groups';
import styles from './BlendModeSelect.module.css';

interface BlendModeSelectProps {
  value: BlendMode;
  /** Groups also offer Pass Through. */
  isGroup: boolean;
  /** False when the document's color mode can't run the HSL blend modes. */
  allowHsl: boolean;
  onChange: (mode: BlendMode) => void;
}

export function BlendModeSelect({ value, isGroup, allowHsl, onChange }: BlendModeSelectProps) {
  const groups = blendModeGroupsFor(isGroup, allowHsl);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value as BlendMode);
  };

  return (
    <div className={styles.row}>
      {/* Only one drawer shows a Blend control at a time; tests key on this id. */}
      <label className={styles.label} id="blend-mode-label">Blend</label>
      <select
        className={styles.select}
        value={value}
        onChange={handleChange}
        aria-labelledby="blend-mode-label"
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.modes.map((mode) => (
              <option key={mode} value={mode}>
                {BLEND_MODE_TO_DISPLAY[mode]}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
