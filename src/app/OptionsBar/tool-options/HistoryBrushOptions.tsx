import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function HistoryBrushOptions() {
  const size = useToolSettingsStore((s) => s.historyBrushSize);
  const opacity = useToolSettingsStore((s) => s.historyBrushOpacity);
  const hardness = useToolSettingsStore((s) => s.historyBrushHardness);
  const setSize = useToolSettingsStore((s) => s.setHistoryBrushSize);
  const setOpacity = useToolSettingsStore((s) => s.setHistoryBrushOpacity);
  const setHardness = useToolSettingsStore((s) => s.setHistoryBrushHardness);
  const sourceId = useToolSettingsStore((s) => s.historyBrushSourceId);

  const originId = useEditorStore((s) => s.originSnapshotId);
  const undoStack = useEditorStore((s) => s.undoStack);

  let sourceLabel = 'None';
  if (sourceId === originId) {
    sourceLabel = 'Original';
  } else if (sourceId) {
    const idx = undoStack.findIndex((s) => s.id === sourceId);
    if (idx >= 0) sourceLabel = `${idx + 1}. ${undoStack[idx]!.label}`;
  }

  return (
    <>
      <Slider label="Size" value={size} min={1} max={200} onChange={setSize} />
      <Slider label="Opacity" value={opacity} min={1} max={100} onChange={setOpacity} />
      <Slider label="Hardness" value={hardness} min={0} max={100} onChange={setHardness} />
      <span className={styles.hint}>Source: {sourceLabel}</span>
    </>
  );
}
