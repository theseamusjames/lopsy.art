import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import type { DodgeMode } from '../../../tools/dodge/dodge';
import styles from '../OptionsBar.module.css';

export function DodgeOptions() {
  const dodgeExposure = useToolSettingsStore((s) => s.dodgeExposure);
  const dodgeMode = useToolSettingsStore((s) => s.dodgeMode);
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const setDodgeExposure = useToolSettingsStore((s) => s.setDodgeExposure);
  const setDodgeMode = useToolSettingsStore((s) => s.setDodgeMode);
  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);

  return (
    <>
      <span className={styles.label}>Mode</span>
      <select
        className={styles.select}
        value={dodgeMode}
        onChange={(e) => setDodgeMode(e.target.value as DodgeMode)}
      >
        <option value="dodge">Dodge</option>
        <option value="burn">Burn</option>
      </select>
      <Slider label="Exposure" value={dodgeExposure} min={1} max={100} onChange={setDodgeExposure} />
      <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
    </>
  );
}
