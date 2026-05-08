import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';
import styles from '../OptionsBar.module.css';

export function StampOptions() {
  const stampSize = useToolSettingsStore((s) => s.stampSize);
  const setStampSize = useToolSettingsStore((s) => s.setStampSize);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={stampSize} min={1} max={sizeMax} sliderMax={300} onChange={setStampSize} />
      <span className={styles.hint}>Alt/Cmd+click to set source</span>
    </>
  );
}
