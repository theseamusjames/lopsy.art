import type { ColorOverlayEffect } from '../../types';
import { EffectColorInput } from './EffectColorInput';
import styles from './LayerEffectsPanel.module.css';

interface ColorOverlayFormProps {
  overlay: ColorOverlayEffect;
  onChange: (o: ColorOverlayEffect) => void;
  onColorEditStart?: () => void;
}

export function ColorOverlayForm({ overlay, onChange, onColorEditStart }: ColorOverlayFormProps) {
  return (
    <div className={styles.row}>
      <span className={styles.fieldLabel}>Color</span>
      <EffectColorInput
        color={overlay.color}
        ariaLabel="Overlay color"
        onChange={(color) => onChange({ ...overlay, color })}
        onEditStart={onColorEditStart}
      />
    </div>
  );
}
