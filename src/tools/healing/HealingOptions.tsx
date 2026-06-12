import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../../components/Slider/Slider';
import { docScaledMax } from '../../utils/slider-ranges';
import styles from '../../app/OptionsBar/OptionsBar.module.css';

export function HealingOptions() {
  const healingSize = useToolSettingsStore((s) => s.settings.healing.size);
  const healingOpacity = useToolSettingsStore((s) => s.settings.healing.opacity);
  const setHealingSetting = useToolSettingsStore((s) => s.setHealingSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={healingSize} min={1} max={sizeMax} onChange={(v) => setHealingSetting('size', v)} />
      <Slider label="Opacity" value={healingOpacity} min={1} max={100} onChange={(v) => setHealingSetting('opacity', v)} />
      <span className={styles.hint}>Alt/Cmd+click to set source</span>
    </>
  );
}
