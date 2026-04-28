import { Slider } from '../../components/Slider/Slider';
import type { GlowEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface GlowFormProps {
  glow: GlowEffect;
  onChange: (g: GlowEffect) => void;
  onCommit?: () => void;
}

export function GlowForm({ glow, onChange, onCommit }: GlowFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${glow.color.r}, ${glow.color.g}, ${glow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(glow.color)}
            aria-label="Glow color"
            onChange={(e) => onChange({ ...glow, color: hexToColor(e.target.value, glow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Size" value={glow.size} min={0} max={100} onChange={(v) => onChange({ ...glow, size: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Spread" value={glow.spread} min={0} max={100} onChange={(v) => onChange({ ...glow, spread: v })} onCommit={onCommit} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider
            label="Opacity"
            value={Math.round(glow.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...glow, opacity: v / 100 })}
            onCommit={onCommit}
          />
        </div>
      </div>
    </>
  );
}
