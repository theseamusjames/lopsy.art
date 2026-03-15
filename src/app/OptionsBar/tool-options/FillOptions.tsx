import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function FillOptions() {
  const fillTolerance = useToolSettingsStore((s) => s.fillTolerance);
  const fillContiguous = useToolSettingsStore((s) => s.fillContiguous);
  const setFillTolerance = useToolSettingsStore((s) => s.setFillTolerance);
  const setFillContiguous = useToolSettingsStore((s) => s.setFillContiguous);

  return (
    <>
      <Slider label="Tolerance" value={fillTolerance} min={0} max={255} onChange={setFillTolerance} />
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={fillContiguous}
          onChange={(e) => setFillContiguous(e.target.checked)}
        />
        Contiguous
      </label>
    </>
  );
}
