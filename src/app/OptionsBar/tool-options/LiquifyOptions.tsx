import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function LiquifyOptions() {
  const liquifySize = useToolSettingsStore((s) => s.liquifySize);
  const liquifyStrength = useToolSettingsStore((s) => s.liquifyStrength);
  const liquifyMode = useToolSettingsStore((s) => s.liquifyMode);
  const setLiquifySize = useToolSettingsStore((s) => s.setLiquifySize);
  const setLiquifyStrength = useToolSettingsStore((s) => s.setLiquifyStrength);
  const setLiquifyMode = useToolSettingsStore((s) => s.setLiquifyMode);

  return (
    <>
      <label className={styles.label} id="liquify-mode-label">Mode</label>
      <select
        className={styles.select}
        value={liquifyMode}
        onChange={(e) => setLiquifyMode(e.target.value as 'push' | 'pinch' | 'twirl')}
        aria-labelledby="liquify-mode-label"
      >
        <option value="push">Push Forward</option>
        <option value="pinch">Pinch</option>
        <option value="twirl">Twirl</option>
      </select>
      <Slider label="Size" value={liquifySize} min={5} max={200} onChange={setLiquifySize} />
      <Slider label="Strength" value={liquifyStrength} min={1} max={100} onChange={setLiquifyStrength} />
    </>
  );
}
