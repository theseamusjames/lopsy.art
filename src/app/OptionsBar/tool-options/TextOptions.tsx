import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import { FontPicker } from '../../../components/FontPicker/FontPicker';
import styles from '../OptionsBar.module.css';

export function TextOptions() {
  const textFontSize = useToolSettingsStore((s) => s.textFontSize);
  const textFontFamily = useToolSettingsStore((s) => s.textFontFamily);
  const textFontWeight = useToolSettingsStore((s) => s.textFontWeight);
  const textFontStyle = useToolSettingsStore((s) => s.textFontStyle);
  const textAlign = useToolSettingsStore((s) => s.textAlign);
  const setTextFontSize = useToolSettingsStore((s) => s.setTextFontSize);
  const setTextFontFamily = useToolSettingsStore((s) => s.setTextFontFamily);
  const setTextFontWeight = useToolSettingsStore((s) => s.setTextFontWeight);
  const setTextFontStyle = useToolSettingsStore((s) => s.setTextFontStyle);
  const setTextAlign = useToolSettingsStore((s) => s.setTextAlign);

  return (
    <>
      <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
      <span className={styles.label}>Font</span>
      <FontPicker value={textFontFamily} onChange={setTextFontFamily} />
      <select
        className={styles.select}
        value={textFontWeight}
        onChange={(e) => setTextFontWeight(Number(e.target.value))}
      >
        <option value={400}>Normal</option>
        <option value={700}>Bold</option>
      </select>
      <select
        className={styles.select}
        value={textFontStyle}
        onChange={(e) => setTextFontStyle(e.target.value as 'normal' | 'italic')}
      >
        <option value="normal">Normal</option>
        <option value="italic">Italic</option>
      </select>
      <span className={styles.label}>Align</span>
      <select
        className={styles.select}
        value={textAlign}
        onChange={(e) => setTextAlign(e.target.value as 'left' | 'center' | 'right' | 'justify')}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
        <option value="justify">Justify</option>
      </select>
    </>
  );
}
