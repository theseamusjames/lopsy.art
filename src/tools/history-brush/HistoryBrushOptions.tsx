import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../../components/Slider/Slider';
import { docScaledMax } from '../../utils/slider-ranges';
import styles from '../../app/OptionsBar/OptionsBar.module.css';

export function HistoryBrushOptions() {
  const historyBrushSize = useToolSettingsStore((s) => s.historyBrushSize);
  const historyBrushOpacity = useToolSettingsStore((s) => s.historyBrushOpacity);
  const historyBrushHardness = useToolSettingsStore((s) => s.historyBrushHardness);
  const setHistoryBrushSize = useToolSettingsStore((s) => s.setHistoryBrushSize);
  const setHistoryBrushOpacity = useToolSettingsStore((s) => s.setHistoryBrushOpacity);
  const setHistoryBrushHardness = useToolSettingsStore((s) => s.setHistoryBrushHardness);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={historyBrushSize} min={1} max={sizeMax} onChange={setHistoryBrushSize} />
      <Slider label="Opacity" value={historyBrushOpacity} min={1} max={100} onChange={setHistoryBrushOpacity} />
      <Slider label="Hardness" value={historyBrushHardness} min={0} max={100} onChange={setHistoryBrushHardness} />
      <span className={styles.hint}>Click source icon in History panel</span>
    </>
  );
}
