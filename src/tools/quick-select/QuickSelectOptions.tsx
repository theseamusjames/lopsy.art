import { useToolSettingsStore } from '../../app/tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import styles from '../../app/OptionsBar/OptionsBar.module.css';

export function QuickSelectOptions() {
  const size = useToolSettingsStore((s) => s.settings.quickSelect.size);
  const tolerance = useToolSettingsStore((s) => s.settings.quickSelect.tolerance);
  const edgeStrength = useToolSettingsStore((s) => s.settings.quickSelect.edgeStrength);
  const mode = useToolSettingsStore((s) => s.settings.quickSelect.mode);
  const setQuickSelectSetting = useToolSettingsStore((s) => s.setQuickSelectSetting);

  return (
    <>
      <Slider label="Size" value={size} min={1} max={100} onChange={(v) => setQuickSelectSetting('size', v)} />
      <Slider label="Tolerance" value={tolerance} min={0} max={255} onChange={(v) => setQuickSelectSetting('tolerance', v)} />
      <Slider label="Edge Strength" value={edgeStrength} min={0} max={100} onChange={(v) => setQuickSelectSetting('edgeStrength', v)} />
      <label className={styles.checkbox}>
        <input
          type="radio"
          name="quick-select-mode"
          checked={mode === 'add'}
          onChange={() => setQuickSelectSetting('mode', 'add')}
        />
        Add
      </label>
      <label className={styles.checkbox}>
        <input
          type="radio"
          name="quick-select-mode"
          checked={mode === 'subtract'}
          onChange={() => setQuickSelectSetting('mode', 'subtract')}
        />
        Subtract
      </label>
    </>
  );
}
