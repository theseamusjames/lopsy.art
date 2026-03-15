import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function StampOptions() {
  const stampSize = useToolSettingsStore((s) => s.stampSize);
  const setStampSize = useToolSettingsStore((s) => s.setStampSize);

  return (
    <>
      <Slider label="Size" value={stampSize} min={1} max={200} onChange={setStampSize} />
      <span className={styles.hint}>Alt+click to set source</span>
    </>
  );
}
