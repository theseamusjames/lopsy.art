import type { ColorOverlayEffect } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface ColorOverlayFormProps {
  overlay: ColorOverlayEffect;
  onChange: (o: ColorOverlayEffect) => void;
}

export function ColorOverlayForm({ overlay, onChange }: ColorOverlayFormProps) {
  return (
    <div className={styles.row}>
      <span className={styles.fieldLabel}>Color</span>
      <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${overlay.color.r}, ${overlay.color.g}, ${overlay.color.b})` }}>
        <input
          type="color"
          className={styles.colorInput}
          value={colorToHex(overlay.color)}
          aria-label="Overlay color"
          onChange={(e) => onChange({ ...overlay, color: hexToColor(e.target.value, overlay.color.a) })}
        />
      </label>
    </div>
  );
}
