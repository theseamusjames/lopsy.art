import type { BlendMode } from '../../types';
import { BLEND_MODE_TO_DISPLAY } from '../../types/blend-mode-tables';
import { HSL_BLEND_MODES } from '../../utils/color-mode-capabilities';
import styles from './BlendModeSelect.module.css';

interface BlendModeGroup {
  label: string;
  modes: BlendMode[];
}

// Grouping is a UX choice, not a Rust-side concept — the engine treats all
// blend modes uniformly.
const BLEND_MODE_GROUPS: BlendModeGroup[] = [
  { label: 'Normal', modes: ['normal'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'color-burn'] },
  { label: 'Lighten', modes: ['lighten', 'screen', 'color-dodge'] },
  { label: 'Contrast', modes: ['overlay', 'soft-light', 'hard-light'] },
  { label: 'Comparative', modes: ['difference', 'exclusion'] },
  { label: 'Composite', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];

// Pass Through is only valid on group layers and appears at the top of the list.
const GROUP_BLEND_MODE_GROUPS: BlendModeGroup[] = [
  { label: 'Pass Through', modes: ['pass-through'] },
  ...BLEND_MODE_GROUPS,
];

export function blendModeGroupsFor(isGroup: boolean, allowHsl: boolean): BlendModeGroup[] {
  return (isGroup ? GROUP_BLEND_MODE_GROUPS : BLEND_MODE_GROUPS)
    .map((group) => ({ ...group, modes: group.modes.filter((m) => allowHsl || !HSL_BLEND_MODES.has(m)) }))
    .filter((group) => group.modes.length > 0);
}

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
