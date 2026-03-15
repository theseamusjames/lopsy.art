import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

const FONT_OPTIONS = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Courier New, monospace', label: 'Courier New' },
  { value: 'JetBrains Mono, monospace', label: 'JetBrains Mono' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: 'Comic Sans MS, cursive', label: 'Comic Sans MS' },
  { value: 'Palatino, serif', label: 'Palatino' },
  { value: 'Garamond, serif', label: 'Garamond' },
  { value: 'Brush Script MT, cursive', label: 'Brush Script' },
];

export function TextOptions() {
  const textContent = useToolSettingsStore((s) => s.textContent);
  const textFontSize = useToolSettingsStore((s) => s.textFontSize);
  const textFontFamily = useToolSettingsStore((s) => s.textFontFamily);
  const textFontWeight = useToolSettingsStore((s) => s.textFontWeight);
  const textFontStyle = useToolSettingsStore((s) => s.textFontStyle);
  const setTextContent = useToolSettingsStore((s) => s.setTextContent);
  const setTextFontSize = useToolSettingsStore((s) => s.setTextFontSize);
  const setTextFontFamily = useToolSettingsStore((s) => s.setTextFontFamily);
  const setTextFontWeight = useToolSettingsStore((s) => s.setTextFontWeight);
  const setTextFontStyle = useToolSettingsStore((s) => s.setTextFontStyle);

  return (
    <>
      <span className={styles.label}>Text</span>
      <input
        className={styles.textInput}
        type="text"
        value={textContent}
        onChange={(e) => setTextContent(e.target.value)}
      />
      <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
      <span className={styles.label}>Font</span>
      <select
        className={styles.select}
        value={textFontFamily}
        onChange={(e) => setTextFontFamily(e.target.value)}
      >
        {FONT_OPTIONS.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
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
    </>
  );
}
