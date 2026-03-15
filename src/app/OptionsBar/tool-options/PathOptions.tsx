import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function PathOptions() {
  const pathStrokeWidth = useToolSettingsStore((s) => s.pathStrokeWidth);
  const setPathStrokeWidth = useToolSettingsStore((s) => s.setPathStrokeWidth);

  return (
    <>
      <Slider label="Stroke" value={pathStrokeWidth} min={1} max={50} onChange={setPathStrokeWidth} />
      <span className={styles.hint}>Enter to stroke, Esc to cancel</span>
    </>
  );
}
