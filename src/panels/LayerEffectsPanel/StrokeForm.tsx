import { Slider } from '../../components/Slider/Slider';
import type { StrokeEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface StrokeFormProps {
  stroke: StrokeEffect;
  onChange: (s: StrokeEffect) => void;
}

export function StrokeForm({ stroke, onChange }: StrokeFormProps) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${stroke.color.r}, ${stroke.color.g}, ${stroke.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(stroke.color)}
            onChange={(e) => onChange({ ...stroke, color: hexToColor(e.target.value, stroke.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Width</span>
        <div className={styles.sliderWrap}>
          <Slider value={stroke.width} min={1} max={50} onChange={(v) => onChange({ ...stroke, width: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Position</span>
        <div className={styles.positionGroup}>
          {(['outside', 'center', 'inside'] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              className={`${styles.positionBtn} ${stroke.position === pos ? styles.positionBtnActive : ''}`}
              onClick={() => onChange({ ...stroke, position: pos })}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
