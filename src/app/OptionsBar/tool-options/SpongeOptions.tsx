import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';
import type { SpongeMode } from '../../../tools/sponge/sponge';
import styles from '../OptionsBar.module.css';

export function SpongeOptions() {
  const spongeMode = useToolSettingsStore((s) => s.spongeMode);
  const spongeStrength = useToolSettingsStore((s) => s.spongeStrength);
  const spongeSize = useToolSettingsStore((s) => s.spongeSize);
  const setSpongeMode = useToolSettingsStore((s) => s.setSpongeMode);
  const setSpongeStrength = useToolSettingsStore((s) => s.setSpongeStrength);
  const setSpongeSize = useToolSettingsStore((s) => s.setSpongeSize);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <label className={styles.label} id="sponge-mode-label">Mode</label>
      <select
        className={styles.select}
        value={spongeMode}
        onChange={(e) => setSpongeMode(e.target.value as SpongeMode)}
        aria-labelledby="sponge-mode-label"
      >
        <option value="saturate">Saturate</option>
        <option value="desaturate">Desaturate</option>
      </select>
      <Slider label="Strength" value={spongeStrength} min={1} max={100} onChange={setSpongeStrength} />
      <Slider label="Size" value={spongeSize} min={1} max={sizeMax} sliderMax={300} onChange={setSpongeSize} />
    </>
  );
}
