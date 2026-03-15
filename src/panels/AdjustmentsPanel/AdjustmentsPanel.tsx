import { Eye, EyeOff } from 'lucide-react';
import { Slider } from '../../components/Slider/Slider';
import { useUIStore } from '../../app/ui-store';
import { DEFAULT_ADJUSTMENTS } from '../../filters/image-adjustments';
import type { ImageAdjustments } from '../../filters/image-adjustments';
import styles from './AdjustmentsPanel.module.css';

interface AdjustmentSliderDef {
  key: keyof ImageAdjustments;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: AdjustmentSliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.1 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1 },
];

export function AdjustmentsPanel() {
  const adjustments = useUIStore((s) => s.adjustments);
  const adjustmentsEnabled = useUIStore((s) => s.adjustmentsEnabled);
  const setAdjustments = useUIStore((s) => s.setAdjustments);
  const setAdjustmentsEnabled = useUIStore((s) => s.setAdjustmentsEnabled);

  const handleChange = (key: keyof ImageAdjustments, value: number) => {
    setAdjustments({ ...adjustments, [key]: value });
  };

  const handleReset = () => {
    setAdjustments({ ...DEFAULT_ADJUSTMENTS });
  };

  return (
    <div className={styles.panel}>
      {SLIDERS.map((s) => (
        <Slider
          key={s.key}
          label={s.label}
          value={adjustments[s.key]}
          min={s.min}
          max={s.max}
          step={s.step}
          defaultValue={0}
          onChange={(v) => handleChange(s.key, v)}
          showValue={false}
        />
      ))}
      <div className={styles.footer}>
        <button type="button" className={styles.textBtn} onClick={handleReset}>
          Reset
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${!adjustmentsEnabled ? styles.iconBtnOff : ''}`}
          onClick={() => setAdjustmentsEnabled(!adjustmentsEnabled)}
        >
          {adjustmentsEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );
}
