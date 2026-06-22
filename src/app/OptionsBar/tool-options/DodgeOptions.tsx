import { useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';
import type { DodgeMode } from '../../../tools/dodge/dodge';
import styles from '../OptionsBar.module.css';

export function DodgeOptions() {
  const dodgeExposure = useToolSettingsStore((s) => s.dodgeExposure);
  const dodgeMode = useToolSettingsStore((s) => s.dodgeMode);
  const brushSize = useToolSettingsStore((s) => s.settings.brush.size);
  const setDodgeExposure = useToolSettingsStore((s) => s.setDodgeExposure);
  const setDodgeMode = useToolSettingsStore((s) => s.setDodgeMode);
  const setBrushSetting = useToolSettingsStore((s) => s.setBrushSetting);
  const setBrushSize = useCallback((v: number) => setBrushSetting('size', v), [setBrushSetting]);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <label className={styles.label} id="dodge-mode-label">Mode</label>
      <select
        className={styles.select}
        value={dodgeMode}
        onChange={(e) => setDodgeMode(e.target.value as DodgeMode)}
        aria-labelledby="dodge-mode-label"
      >
        <option value="dodge">Dodge</option>
        <option value="burn">Burn</option>
      </select>
      <Slider label="Exposure" value={dodgeExposure} min={1} max={100} onChange={setDodgeExposure} />
      <Slider label="Size" value={brushSize} min={1} max={sizeMax} sliderMax={300} onChange={setBrushSize} />
    </>
  );
}
