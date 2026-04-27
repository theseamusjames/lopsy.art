import { useCallback, useMemo } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import { FontPicker } from '../../../components/FontPicker/FontPicker';
import { fontsByFamily } from '../../../utils/font-catalog';
import { extractFamilyName, loadGoogleFont } from '../../../utils/font-loader';
import type { FontStyle, TextAlign } from '../../../types';
import styles from '../OptionsBar.module.css';

const WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
  1000: 'UltraBlack',
};

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

  const fontEntry = useMemo(() => {
    const family = extractFamilyName(textFontFamily);
    return fontsByFamily.get(family);
  }, [textFontFamily]);

  const availableWeights = fontEntry?.weights ?? [400, 700];

  const handleFontChange = useCallback(
    (value: string) => {
      setTextFontFamily(value);
      const family = extractFamilyName(value);
      const entry = fontsByFamily.get(family);
      if (entry) {
        if (!entry.weights.includes(textFontWeight)) {
          const nearest = entry.weights.reduce((prev, curr) =>
            Math.abs(curr - textFontWeight) < Math.abs(prev - textFontWeight) ? curr : prev,
          );
          setTextFontWeight(nearest);
        }
        if (entry.source === 'google') {
          loadGoogleFont(family, entry.weights);
        }
      }
    },
    [textFontWeight, setTextFontFamily, setTextFontWeight],
  );

  return (
    <>
      <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
      <label className={styles.label} id="text-font-label">Font</label>
      <FontPicker value={textFontFamily} onChange={handleFontChange} />
      <select
        className={styles.select}
        value={textFontWeight}
        onChange={(e) => setTextFontWeight(Number(e.target.value))}
        aria-label="Font weight"
      >
        {availableWeights.map((w) => (
          <option key={w} value={w}>{WEIGHT_LABELS[w] ?? String(w)}</option>
        ))}
      </select>
      <select
        className={styles.select}
        value={textFontStyle}
        onChange={(e) => setTextFontStyle(e.target.value as FontStyle)}
        aria-label="Font style"
      >
        <option value="normal">Normal</option>
        <option value="italic">Italic</option>
      </select>
      <label className={styles.label} id="text-align-label">Align</label>
      <select
        className={styles.select}
        value={textAlign}
        onChange={(e) => setTextAlign(e.target.value as TextAlign)}
        aria-labelledby="text-align-label"
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
        <option value="justify">Justify</option>
      </select>
    </>
  );
}
