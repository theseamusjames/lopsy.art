import { useState } from 'react';
import { Slider } from '../../components/Slider/Slider';
import { type Levels, type LevelsChannel } from '../../filters/levels';
import styles from './LevelsEditor.module.css';

const CHANNEL_ORDER = ['rgb', 'r', 'g', 'b'] as const;
type ChannelKey = keyof Pick<Levels, 'rgb' | 'r' | 'g' | 'b'>;

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  rgb: '#e0e0e0',
  r: '#ff5e5e',
  g: '#5eff7e',
  b: '#5e9eff',
};

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  rgb: 'RGB',
  r: 'R',
  g: 'G',
  b: 'B',
};

interface ChannelSliderDef {
  key: keyof LevelsChannel;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
}

const channelSliders: ChannelSliderDef[] = [
  { key: 'inputBlack', label: 'Input Black', min: 0, max: 255, step: 1 },
  { key: 'inputWhite', label: 'Input White', min: 0, max: 255, step: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.01, max: 10, step: 0.01, scale: 'log' },
  { key: 'outputBlack', label: 'Output Black', min: 0, max: 255, step: 1 },
  { key: 'outputWhite', label: 'Output White', min: 0, max: 255, step: 1 },
];

interface LevelsEditorProps {
  levels: Levels;
  onChange: (levels: Levels) => void;
  onReset: () => void;
}

export function LevelsEditor({ levels, onChange, onReset }: LevelsEditorProps) {
  const [channel, setChannel] = useState<ChannelKey>('rgb');

  const N255 = (v: number) => v / 255;

  const handleChannelChange = (key: keyof LevelsChannel, value: number) => {
    const ch = levels[channel];
    // Input/output sliders use [0, 255] but LevelsChannel expects [0, 1].
    const normalized = ['inputBlack', 'inputWhite', 'outputBlack', 'outputWhite'].includes(key)
      ? N255(value)
      : value;
    onChange({ ...levels, [channel]: { ...ch, [key]: normalized } });
  };

  const isChannelIdentity = (ch: LevelsChannel): boolean =>
    ch.inputBlack === 0 && ch.inputWhite === 1 && ch.gamma === 1 && ch.outputBlack === 0 && ch.outputWhite === 1;

  const allIdentity = CHANNEL_ORDER.every((c) => isChannelIdentity(levels[c]));

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.label}>Levels</span>
        <div className={styles.channelTabs} role="tablist" aria-label="Levels channel">
          {CHANNEL_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              className={`${styles.channelTab} ${channel === c ? styles.channelTabActive : ''}`}
              style={{ color: CHANNEL_COLORS[c] }}
              onClick={() => setChannel(c)}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={onReset}
          disabled={allIdentity}
        >
          Reset
        </button>
      </div>
      <div className={styles.sliders}>
        {channelSliders.map((s) => {
          const rawValue = levels[channel][s.key];
          // LevelsChannel stores [0,1] but 0-255 sliders expect [0,255].
          const is255Slider = ['inputBlack', 'inputWhite', 'outputBlack', 'outputWhite'].includes(s.key);
          const displayValue = is255Slider ? Math.round(rawValue * 255) : rawValue;
          return (
            <Slider
              key={`${channel}.${s.key}`}
              label={s.label}
              value={displayValue}
              min={s.min}
              max={s.max}
              step={is255Slider ? s.step : 0.01}
              scale={s.scale}
              defaultValue={s.key === 'gamma' ? Math.sqrt(s.min * s.max) : 0}
              onChange={(v) => handleChannelChange(s.key, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
