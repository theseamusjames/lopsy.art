import { AspectRatioControl } from './AspectRatioControl';
import { Slider } from '../../../components/Slider/Slider';
import { useToolSettingsStore } from '../../tool-settings-store';
import styles from './ToolOptions.module.css';

export function MarqueeOptions() {
  const marqueeFeather = useToolSettingsStore((s) => s.marqueeFeather);
  const setMarqueeFeather = useToolSettingsStore((s) => s.setMarqueeFeather);

  return (
    <div className={styles.container}>
      <AspectRatioControl />
      <div className={styles.sliderGroup}>
        <label className={styles.label}>Feather</label>
        <Slider
          value={marqueeFeather}
          onChange={setMarqueeFeather}
          min={0}
          max={250}
          step={1}
        />
        <span className={styles.value}>{marqueeFeather} px</span>
      </div>
    </div>
  );
}
