import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../../components/Slider/Slider';
import { docScaledMax } from '../../utils/slider-ranges';
import styles from '../../app/OptionsBar/OptionsBar.module.css';

export function HealingOptions() {
  const healingSize = useToolSettingsStore((s) => s.healingSize);
  const setHealingSize = useToolSettingsStore((s) => s.setHealingSize);
  const healingOpacity = useToolSettingsStore((s) => s.healingOpacity);
  const setHealingOpacity = useToolSettingsStore((s) => s.setHealingOpacity);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={healingSize} min={1} max={sizeMax} onChange={setHealingSize} />
      <Slider label="Opacity" value={healingOpacity} min={1} max={100} onChange={setHealingOpacity} />
      <span className={styles.hint}>Alt/Cmd+click to set source</span>
    </>
  );
}
