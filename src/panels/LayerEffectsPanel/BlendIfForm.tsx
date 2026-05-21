import { Slider } from '../../components/Slider/Slider';
import type { BlendIfEffect, BlendIfChannel } from '../../types';
import styles from './LayerEffectsPanel.module.css';

interface BlendIfFormProps {
  blendIf: BlendIfEffect;
  onChange: (b: BlendIfEffect) => void;
  onDragStart?: () => void;
}

const CHANNEL_OPTIONS: { value: BlendIfChannel; label: string }[] = [
  { value: 'gray', label: 'Gray' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

export function BlendIfForm({ blendIf, onChange, onDragStart }: BlendIfFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Channel</span>
        <select
          className={styles.blendModeSelect}
          value={blendIf.channel}
          onChange={(e) => onChange({ ...blendIf, channel: e.target.value as BlendIfChannel })}
          aria-label="Blend If channel"
        >
          {CHANNEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className={styles.blendIfSection}>
        <span className={styles.blendIfSectionLabel}>This Layer</span>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="Black"
              value={blendIf.thisLayerBlack}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, thisLayerBlack: Math.min(v, blendIf.thisLayerBlackFeather) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="Black Feather"
              value={blendIf.thisLayerBlackFeather}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, thisLayerBlackFeather: Math.max(blendIf.thisLayerBlack, Math.min(v, blendIf.thisLayerWhiteFeather)) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="White Feather"
              value={blendIf.thisLayerWhiteFeather}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, thisLayerWhiteFeather: Math.max(blendIf.thisLayerBlackFeather, Math.min(v, blendIf.thisLayerWhite)) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="White"
              value={blendIf.thisLayerWhite}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, thisLayerWhite: Math.max(v, blendIf.thisLayerWhiteFeather) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
      </div>
      <div className={styles.blendIfSection}>
        <span className={styles.blendIfSectionLabel}>Underlying Layer</span>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="Black"
              value={blendIf.underlyingBlack}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, underlyingBlack: Math.min(v, blendIf.underlyingBlackFeather) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="Black Feather"
              value={blendIf.underlyingBlackFeather}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, underlyingBlackFeather: Math.max(blendIf.underlyingBlack, Math.min(v, blendIf.underlyingWhiteFeather)) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="White Feather"
              value={blendIf.underlyingWhiteFeather}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, underlyingWhiteFeather: Math.max(blendIf.underlyingBlackFeather, Math.min(v, blendIf.underlyingWhite)) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.sliderWrap}>
            <Slider
              label="White"
              value={blendIf.underlyingWhite}
              min={0}
              max={255}
              step={1}
              onChange={(v) => onChange({ ...blendIf, underlyingWhite: Math.max(v, blendIf.underlyingWhiteFeather) })}
              onDragStart={onDragStart}
            />
          </div>
        </div>
      </div>
    </>
  );
}
