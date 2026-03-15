import { Slider } from '../../components/Slider/Slider';
import type { GlowEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface GlowFormProps {
  glow: GlowEffect;
  onChange: (g: GlowEffect) => void;
}

export function GlowForm({ glow, onChange }: GlowFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${glow.color.r}, ${glow.color.g}, ${glow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(glow.color)}
            onChange={(e) => onChange({ ...glow, color: hexToColor(e.target.value, glow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Size</span>
        <div className={styles.sliderWrap}>
          <Slider value={glow.size} min={0} max={100} onChange={(v) => onChange({ ...glow, size: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Spread</span>
        <div className={styles.sliderWrap}>
          <Slider value={glow.spread} min={0} max={100} onChange={(v) => onChange({ ...glow, spread: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Opacity</span>
        <div className={styles.sliderWrap}>
          <Slider
            value={Math.round(glow.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...glow, opacity: v / 100 })}
          />
        </div>
      </div>
    </>
  );
}
