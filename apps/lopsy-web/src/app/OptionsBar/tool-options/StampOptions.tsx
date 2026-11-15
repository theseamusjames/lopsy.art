import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';
import styles from '../OptionsBar.module.css';

export function StampOptions() {
  const stampSize = useToolSettingsStore((s) => s.settings.stamp.size);
  const setStampSetting = useToolSettingsStore((s) => s.setStampSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={stampSize} min={1} max={sizeMax} sliderMax={300} onChange={(size) => setStampSetting('size', size)} />
      <span className={styles.hint}>Alt/Cmd+click to set source</span>
    </>
  );
}
