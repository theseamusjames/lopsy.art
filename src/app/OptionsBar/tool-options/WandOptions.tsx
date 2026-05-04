import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function WandOptions() {
  const wandTolerance = useToolSettingsStore((s) => s.wandTolerance);
  const wandContiguous = useToolSettingsStore((s) => s.wandContiguous);
  const wandGraduated = useToolSettingsStore((s) => s.wandGraduated);
  const setWandTolerance = useToolSettingsStore((s) => s.setWandTolerance);
  const setWandContiguous = useToolSettingsStore((s) => s.setWandContiguous);
  const setWandGraduated = useToolSettingsStore((s) => s.setWandGraduated);

  return (
    <>
      <Slider label="Tolerance" value={wandTolerance} min={0} max={255} onChange={setWandTolerance} />
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={wandContiguous}
          onChange={(e) => setWandContiguous(e.target.checked)}
        />
        Contiguous
      </label>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={wandGraduated}
          onChange={(e) => setWandGraduated(e.target.checked)}
        />
        Graduated
      </label>
    </>
  );
}
