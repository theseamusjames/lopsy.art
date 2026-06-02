import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function WandOptions() {
  const wand = useToolSettingsStore((s) => s.settings.wand);
  const setWandSetting = useToolSettingsStore((s) => s.setWandSetting);

  return (
    <>
      <Slider
        label="Tolerance"
        value={wand.tolerance}
        min={0}
        max={255}
        onChange={(v) => setWandSetting('tolerance', v)}
      />
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={wand.contiguous}
          onChange={(e) => setWandSetting('contiguous', e.target.checked)}
        />
        Contiguous
      </label>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={wand.graduated}
          onChange={(e) => setWandSetting('graduated', e.target.checked)}
        />
        Graduated
      </label>
    </>
  );
}
