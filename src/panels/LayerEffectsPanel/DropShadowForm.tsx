import { Slider } from '../../components/Slider/Slider';
import type { ShadowEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface DropShadowFormProps {
  shadow: ShadowEffect;
  onChange: (s: ShadowEffect) => void;
}

export function DropShadowForm({ shadow, onChange }: DropShadowFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${shadow.color.r}, ${shadow.color.g}, ${shadow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(shadow.color)}
            onChange={(e) => onChange({ ...shadow, color: hexToColor(e.target.value, shadow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Offset X</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.offsetX} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetX: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Offset Y</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.offsetY} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetY: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Blur</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.blur} min={0} max={100} onChange={(v) => onChange({ ...shadow, blur: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Spread</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.spread} min={0} max={100} onChange={(v) => onChange({ ...shadow, spread: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Opacity</span>
        <div className={styles.sliderWrap}>
          <Slider
            value={Math.round((shadow.opacity ?? 0.75) * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...shadow, opacity: v / 100 })}
          />
        </div>
      </div>
    </>
  );
}
