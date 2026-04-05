import { Eye, EyeOff } from 'lucide-react';
import { Slider } from '../../components/Slider/Slider';
import { useEditorStore } from '../../app/editor-store';
import { DEFAULT_ADJUSTMENTS } from '../../filters/image-adjustments';
import type { ImageAdjustments } from '../../filters/image-adjustments';
import type { GroupLayer } from '../../types';
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

function useActiveGroup(): GroupLayer | null {
  return useEditorStore((s) => {
    const activeId = s.document.activeLayerId;
    // If active layer is a group, use it
    if (activeId) {
      const active = s.document.layers.find((l) => l.id === activeId);
      if (active?.type === 'group') return active as GroupLayer;
    }
    // Otherwise use the root group
    const rootId = s.document.rootGroupId;
    if (rootId) {
      const root = s.document.layers.find((l) => l.id === rootId);
      if (root?.type === 'group') return root as GroupLayer;
    }
    return null;
  });
}

export function AdjustmentsPanel() {
  const group = useActiveGroup();
  const setGroupAdjustments = useEditorStore((s) => s.setGroupAdjustments);
  const setGroupAdjustmentsEnabled = useEditorStore((s) => s.setGroupAdjustmentsEnabled);

  if (!group) return null;

  const adjustments = group.adjustments ?? DEFAULT_ADJUSTMENTS;
  const adjustmentsEnabled = group.adjustmentsEnabled ?? true;

  const handleChange = (key: keyof ImageAdjustments, value: number) => {
    setGroupAdjustments(group.id, { ...adjustments, [key]: value });
  };

  const handleReset = () => {
    setGroupAdjustments(group.id, { ...DEFAULT_ADJUSTMENTS });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.groupLabel}>{group.name}</div>
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
          onClick={() => setGroupAdjustmentsEnabled(group.id, !adjustmentsEnabled)}
        >
          {adjustmentsEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );
}
