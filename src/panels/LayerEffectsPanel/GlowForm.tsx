import { Slider } from '../../components/Slider/Slider';
import type { GlowEffect } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax } from '../../utils/slider-ranges';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface GlowFormProps {
  glow: GlowEffect;
  onChange: (g: GlowEffect) => void;
  onDragStart?: () => void;
}

export function GlowForm({ glow, onChange, onDragStart }: GlowFormProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 100);
  const spreadMax = docScaledMax(docWidth, docHeight, 100);

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
          <Slider label="Size" value={glow.size} min={0} max={sizeMax} onChange={(v) => onChange({ ...glow, size: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Spread" value={glow.spread} min={0} max={spreadMax} onChange={(v) => onChange({ ...glow, spread: v })} onDragStart={onDragStart} />
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
            onDragStart={onDragStart}
          />
        </div>
      </div>
    </>
  );
}
