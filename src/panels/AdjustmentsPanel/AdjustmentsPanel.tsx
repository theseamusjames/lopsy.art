import { useCallback } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { DEFAULT_ADJUSTMENTS } from '../../filters/image-adjustments';
import type { ImageAdjustments } from '../../filters/image-adjustments';
import type { BlendMode, GroupLayer } from '../../types';
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

const BLEND_MODES: { group: string; modes: { value: BlendMode; label: string }[] }[] = [
  { group: 'Normal', modes: [{ value: 'normal', label: 'Normal' }] },
  { group: 'Darken', modes: [
    { value: 'darken', label: 'Darken' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'color-burn', label: 'Color Burn' },
  ]},
  { group: 'Lighten', modes: [
    { value: 'lighten', label: 'Lighten' },
    { value: 'screen', label: 'Screen' },
    { value: 'color-dodge', label: 'Color Dodge' },
  ]},
  { group: 'Contrast', modes: [
    { value: 'overlay', label: 'Overlay' },
    { value: 'soft-light', label: 'Soft Light' },
    { value: 'hard-light', label: 'Hard Light' },
  ]},
  { group: 'Comparative', modes: [
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
  ]},
  { group: 'Composite', modes: [
    { value: 'hue', label: 'Hue' },
    { value: 'saturation', label: 'Saturation' },
    { value: 'color', label: 'Color' },
    { value: 'luminosity', label: 'Luminosity' },
  ]},
];

function useActiveGroup(): GroupLayer | null {
  return useEditorStore((s) => {
    const activeId = s.document.activeLayerId;
    if (activeId) {
      const active = s.document.layers.find((l) => l.id === activeId);
      if (active?.type === 'group') return active as GroupLayer;
    }
    const rootId = s.document.rootGroupId;
    if (rootId) {
      const root = s.document.layers.find((l) => l.id === rootId);
      if (root?.type === 'group') return root as GroupLayer;
    }
    return null;
  });
}

interface AdjustmentsPanelProps {
  showHeader?: boolean;
}

export function AdjustmentsPanel({ showHeader }: AdjustmentsPanelProps = {}) {
  const group = useActiveGroup();
  const setGroupAdjustments = useEditorStore((s) => s.setGroupAdjustments);
  const setGroupAdjustmentsEnabled = useEditorStore((s) => s.setGroupAdjustmentsEnabled);
  const updateLayerBlendMode = useEditorStore((s) => s.updateLayerBlendMode);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);

  const handleBlendModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!group) return;
      useEditorStore.getState().pushHistory('Change Blend Mode');
      updateLayerBlendMode(group.id, e.target.value as BlendMode);
    },
    [group, updateLayerBlendMode],
  );

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
      {showHeader && (
        <div className={styles.header}>
          <span className={styles.headerTitle}>Group Effects</span>
          <IconButton
            icon={<X size={14} />}
            label="Close"
            onClick={() => setShowEffectsDrawer(false)}
          />
        </div>
      )}
      <div className={styles.groupLabel}>{group.name}</div>
      <div className={styles.blendRow}>
        <span className={styles.fieldLabel}>Blend</span>
        <select
          className={styles.blendSelect}
          value={group.blendMode}
          onChange={handleBlendModeChange}
        >
          {BLEND_MODES.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.modes.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
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
