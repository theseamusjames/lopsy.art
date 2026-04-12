import { useToolSettingsStore } from '../../tool-settings-store';
import { GradientEditor } from '../../../components/GradientEditor/GradientEditor';
import type { GradientStop } from '../../../tools/gradient/gradient';
import styles from '../OptionsBar.module.css';

export function GradientOptions() {
  const gradientType = useToolSettingsStore((s) => s.gradientType);
  const setGradientType = useToolSettingsStore((s) => s.setGradientType);
  const gradientStops = useToolSettingsStore((s) => s.gradientStops);
  const setGradientStops = useToolSettingsStore((s) => s.setGradientStops);
  const gradientReverse = useToolSettingsStore((s) => s.gradientReverse);
  const setGradientReverse = useToolSettingsStore((s) => s.setGradientReverse);

  const handleStopsChange = (stops: readonly GradientStop[]) => {
    setGradientStops(stops);
  };

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

      <div className={styles.separator} />

      <GradientEditor stops={gradientStops} onStopsChange={handleStopsChange} />

      <div className={styles.separator} />

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={gradientReverse}
          onChange={(e) => setGradientReverse(e.target.checked)}
        />
        Reverse
      </label>
    </>
  );
}
