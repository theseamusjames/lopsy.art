import { Slider } from '../../components/Slider/Slider';
import type { ShadowEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface DropShadowFormProps {
  shadow: ShadowEffect;
  onChange: (s: ShadowEffect) => void;
  onCommit?: () => void;
}

export function DropShadowForm({ shadow, onChange, onCommit }: DropShadowFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${shadow.color.r}, ${shadow.color.g}, ${shadow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(shadow.color)}
            aria-label="Shadow color"
            onChange={(e) => onChange({ ...shadow, color: hexToColor(e.target.value, shadow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Offset X" value={shadow.offsetX} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetX: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Offset Y" value={shadow.offsetY} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetY: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Blur" value={shadow.blur} min={0} max={100} onChange={(v) => onChange({ ...shadow, blur: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Spread" value={shadow.spread} min={0} max={100} onChange={(v) => onChange({ ...shadow, spread: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider
            label="Opacity"
            value={Math.round((shadow.opacity ?? 0.75) * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...shadow, opacity: v / 100 })}
            onCommit={onCommit}
          />
        </div>
      </div>
    </>
  );
}
