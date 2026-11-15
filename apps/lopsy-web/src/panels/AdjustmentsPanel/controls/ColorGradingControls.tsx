import { useState } from 'react';
import { ColorWheel } from '../../../components/ColorWheel/ColorWheel';
import { Slider } from '../../../components/Slider/Slider';
import { DEFAULT_GRADE_BLENDING } from '../../../filters/color-grading';
import type { ColorGradeWheel, ColorGradingNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

type WheelKey = 'shadows' | 'midtones' | 'highlights' | 'global';

const WHEELS: readonly { key: WheelKey; label: string }[] = [
  { key: 'shadows', label: 'Shadows' },
  { key: 'midtones', label: 'Midtones' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'global', label: 'Global' },
];

export function ColorGradingControls({ node, onChange }: NodeControlProps<ColorGradingNode>) {
  const [selected, setSelected] = useState<WheelKey>('midtones');
  const wheel = node[selected];
  const updateWheel = (key: WheelKey, params: Partial<ColorGradeWheel>) =>
    onChange({ [key]: { ...node[key], ...params } });
  return (
    <div className={styles.sliders}>
      <div className={styles.gradeWheels}>
        {WHEELS.map(({ key, label }) => (
          <ColorWheel
            key={key}
            label={label}
            hue={node[key].hue}
            saturation={node[key].saturation}
            isActive={selected === key}
            onActivate={() => setSelected(key)}
            onChange={(hue, saturation) => updateWheel(key, { hue, saturation })}
          />
        ))}
      </div>
      <div className={styles.gradeTabs} role="tablist" aria-label="Tone range">
        {WHEELS.map(({ key, label }) => (
          <button key={key} type="button" role="tab"
            aria-selected={selected === key}
            className={`${styles.gradeTab} ${selected === key ? styles.gradeTabActive : ''}`}
            onClick={() => setSelected(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <Slider label="Hue" value={wheel.hue} min={0} max={360} step={1} defaultValue={0} suffix="°"
        onChange={(v) => updateWheel(selected, { hue: v })} />
      <Slider label="Saturation" value={wheel.saturation} min={0} max={100} step={1} defaultValue={0}
        onChange={(v) => updateWheel(selected, { saturation: v })} />
      <Slider label="Luminance" value={wheel.luminance} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => updateWheel(selected, { luminance: v })} />
      <div className={styles.gradeDivider} />
      <Slider label="Blending" value={node.blending} min={0} max={100} step={1} defaultValue={DEFAULT_GRADE_BLENDING}
        onChange={(v) => onChange({ blending: v })} />
      <Slider label="Balance" value={node.balance} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ balance: v })} />
    </div>
  );
}
