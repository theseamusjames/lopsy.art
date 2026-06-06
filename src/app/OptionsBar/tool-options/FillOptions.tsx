import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function FillOptions() {
  const fill = useToolSettingsStore((s) => s.settings.fill);
  const setFillSetting = useToolSettingsStore((s) => s.setFillSetting);

  return (
    <>
      <Slider
        label="Tolerance"
        value={fill.tolerance}
        min={0}
        max={255}
        onChange={(v) => setFillSetting('tolerance', v)}
      />
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={fill.contiguous}
          onChange={(e) => setFillSetting('contiguous', e.target.checked)}
        />
        Contiguous
      </label>
    </>
  );
}
