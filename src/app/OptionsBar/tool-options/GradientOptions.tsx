import { useToolSettingsStore } from '../../tool-settings-store';
import styles from '../OptionsBar.module.css';

export function GradientOptions() {
  const gradientType = useToolSettingsStore((s) => s.gradientType);
  const setGradientType = useToolSettingsStore((s) => s.setGradientType);

  return (
    <>
      <span className={styles.label}>Type</span>
      <select
        className={styles.select}
        value={gradientType}
        onChange={(e) => setGradientType(e.target.value as 'linear' | 'radial')}
      >
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>
    </>
  );
}
