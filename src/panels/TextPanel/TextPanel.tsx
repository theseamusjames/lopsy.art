import { useMemo } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import { FontPicker } from '../../components/FontPicker/FontPicker';
import { fontsByFamily } from '../../utils/font-catalog';
import { extractFamilyName } from '../../utils/font-loader';
import {
  applyTextSetting,
  applyTextFontFamily,
  applyTextWeight,
  beginTextLayerHistory,
} from '../../tools/text/apply-text-setting';
import type { FontStyle, TextAlign } from '../../types';
import styles from './TextPanel.module.css';

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

const ALIGNMENTS: { value: TextAlign; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
  { value: 'justify', label: 'Justify', Icon: AlignJustify },
];

export function TextPanel() {
  const text = useToolSettingsStore((s) => s.settings.text);
  const recentFonts = useToolSettingsStore((s) => s.recentFonts);

  const fontEntry = useMemo(() => fontsByFamily.get(extractFamilyName(text.fontFamily)), [text.fontFamily]);
  const availableWeights = fontEntry?.weights ?? [400, 700];

  const discrete = <K extends 'fontStyle' | 'align' | 'underline' | 'strikethrough'>(
    key: K,
    value: (typeof text)[K],
  ) => {
    beginTextLayerHistory();
    applyTextSetting(key, value);
  };

  return (
    <div className={styles.panel} data-panel="text">
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Font</div>
        <FontPicker value={text.fontFamily} onChange={applyTextFontFamily} />
        <div className={styles.row}>
          <select
            className={styles.select}
            value={text.fontWeight}
            onChange={(e) => applyTextWeight(Number(e.target.value))}
            aria-label="Font weight"
          >
            {availableWeights.map((w) => (
              <option key={w} value={w}>{WEIGHT_LABELS[w] ?? String(w)}</option>
            ))}
          </select>
          <select
            className={styles.select}
            value={text.fontStyle}
            onChange={(e) => discrete('fontStyle', e.target.value as FontStyle)}
            aria-label="Font style"
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </div>
        {recentFonts.length > 0 && (
          <div className={styles.recentFonts}>
            {recentFonts.map((family) => (
              <button
                key={family}
                type="button"
                className={styles.recentFont}
                style={{ '--recent-font': `'${family}'` } as React.CSSProperties}
                onClick={() => applyTextFontFamily(`'${family}', sans-serif`)}
                title={family}
              >
                {family}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Character</div>
        <Slider
          label="Size"
          value={text.fontSize}
          min={1}
          max={500}
          suffix="px"
          onDragStart={beginTextLayerHistory}
          onChange={(v) => applyTextSetting('fontSize', v)}
        />
        <Slider
          label="Line height"
          value={text.lineHeight}
          min={0.5}
          max={4}
          step={0.05}
          defaultValue={1.4}
          onDragStart={beginTextLayerHistory}
          onChange={(v) => applyTextSetting('lineHeight', v)}
        />
        <Slider
          label="Letter spacing"
          value={text.letterSpacing}
          min={-20}
          max={200}
          step={0.5}
          defaultValue={0}
          suffix="px"
          onDragStart={beginTextLayerHistory}
          onChange={(v) => applyTextSetting('letterSpacing', v)}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Paragraph</div>
        <div className={styles.alignGroup} role="group" aria-label="Text alignment">
          {ALIGNMENTS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={`${styles.alignBtn} ${text.align === value ? styles.alignBtnActive : ''}`}
              onClick={() => discrete('align', value)}
              aria-label={label}
              aria-pressed={text.align === value}
              title={label}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <Slider
          label="Paragraph spacing"
          value={text.paragraphSpacing}
          min={0}
          max={200}
          step={1}
          defaultValue={0}
          suffix="px"
          onDragStart={beginTextLayerHistory}
          onChange={(v) => applyTextSetting('paragraphSpacing', v)}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Decoration</div>
        <div className={styles.decorationGroup}>
          <button
            type="button"
            className={`${styles.decorationBtn} ${text.underline ? styles.decorationBtnActive : ''}`}
            onClick={() => discrete('underline', !text.underline)}
            aria-label="Toggle underline"
            aria-pressed={text.underline}
            title="Underline"
          >
            <span className={styles.underlineIcon}>U</span>
          </button>
          <button
            type="button"
            className={`${styles.decorationBtn} ${text.strikethrough ? styles.decorationBtnActive : ''}`}
            onClick={() => discrete('strikethrough', !text.strikethrough)}
            aria-label="Toggle strikethrough"
            aria-pressed={text.strikethrough}
            title="Strikethrough"
          >
            <span className={styles.strikethroughIcon}>S</span>
          </button>
        </div>
      </section>
    </div>
  );
}
