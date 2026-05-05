import { useToolSettingsStore } from '../../app/tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import styles from '../../app/OptionsBar/OptionsBar.module.css';

export function QuickSelectOptions() {
  const size = useToolSettingsStore((s) => s.quickSelectSize);
  const tolerance = useToolSettingsStore((s) => s.quickSelectTolerance);
  const edgeStrength = useToolSettingsStore((s) => s.quickSelectEdgeStrength);
  const mode = useToolSettingsStore((s) => s.quickSelectMode);
  const setSize = useToolSettingsStore((s) => s.setQuickSelectSize);
  const setTolerance = useToolSettingsStore((s) => s.setQuickSelectTolerance);
  const setEdgeStrength = useToolSettingsStore((s) => s.setQuickSelectEdgeStrength);
  const setMode = useToolSettingsStore((s) => s.setQuickSelectMode);

  return (
    <>
      <Slider label="Size" value={size} min={1} max={100} onChange={setSize} />
      <Slider label="Tolerance" value={tolerance} min={0} max={255} onChange={setTolerance} />
      <Slider label="Edge Strength" value={edgeStrength} min={0} max={100} onChange={setEdgeStrength} />
      <label className={styles.checkbox}>
        <input
          type="radio"
          name="quick-select-mode"
          checked={mode === 'add'}
          onChange={() => setMode('add')}
        />
        Add
      </label>
      <label className={styles.checkbox}>
        <input
          type="radio"
          name="quick-select-mode"
          checked={mode === 'subtract'}
          onChange={() => setMode('subtract')}
        />
        Subtract
      </label>
    </>
  );
}
