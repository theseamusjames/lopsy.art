import { useState } from 'react';
import { Slider } from '../../../components/Slider/Slider';
import type { ColorBalanceNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function ColorBalanceControls({ node, onChange }: NodeControlProps<ColorBalanceNode>) {
  const [toneRange, setToneRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const current = node[`${toneRange}CMY` as keyof ColorBalanceNode] as [number, number, number];
  return (
    <div className={styles.sliders}>
      <div className={styles.channelTabs} role="tablist" aria-label="Tone range">
        {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
          <button key={range} type="button" role="tab"
            aria-selected={toneRange === range}
            className={`${styles.channelTab} ${toneRange === range ? styles.channelTabActive : ''}`}
            onClick={() => setToneRange(range)}
          >
            {range.charAt(0).toUpperCase() + range.slice(1)}
          </button>
        ))}
      </div>
      <Slider label="Cyan — Red" value={current[0]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [v, current[1], current[2]] })} />
      <Slider label="Magenta — Green" value={current[1]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [current[0], v, current[2]] })} />
      <Slider label="Yellow — Blue" value={current[2]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [current[0], current[1], v] })} />
    </div>
  );
}
