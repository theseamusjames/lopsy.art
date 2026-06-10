import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';
import type { SpongeMode } from '../../../tools/sponge/sponge';
import styles from '../OptionsBar.module.css';

export function SpongeOptions() {
  const sponge = useToolSettingsStore((s) => s.settings.sponge);
  const setSpongeSetting = useToolSettingsStore((s) => s.setSpongeSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <label className={styles.label} id="sponge-mode-label">Mode</label>
      <select
        className={styles.select}
        value={sponge.mode}
        onChange={(e) => setSpongeSetting('mode', e.target.value as SpongeMode)}
        aria-labelledby="sponge-mode-label"
      >
        <option value="saturate">Saturate</option>
        <option value="desaturate">Desaturate</option>
      </select>
      <Slider label="Strength" value={sponge.strength} min={1} max={100} onChange={(v) => setSpongeSetting('strength', v)} />
      <Slider label="Size" value={sponge.size} min={1} max={sizeMax} sliderMax={300} onChange={(v) => setSpongeSetting('size', v)} />
    </>
  );
}
