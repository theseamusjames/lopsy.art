import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { IconButton } from '../../components/IconButton/IconButton';
import type { BlendMode, LayerEffects } from '../../types';
import { DropShadowForm } from './DropShadowForm';
import { StrokeForm } from './StrokeForm';
import { GlowForm } from './GlowForm';
import { ColorOverlayForm } from './ColorOverlayForm';
import styles from './LayerEffectsPanel.module.css';

type EffectKey = 'dropShadow' | 'stroke' | 'outerGlow' | 'innerGlow' | 'colorOverlay';

const BLEND_MODE_GROUPS: { label: string; modes: { value: BlendMode; label: string }[] }[] = [
  {
    label: 'Normal',
    modes: [{ value: 'normal', label: 'Normal' }],
  },
  {
    label: 'Darken',
    modes: [
      { value: 'darken', label: 'Darken' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'color-burn', label: 'Color Burn' },
    ],
  },
  {
    label: 'Lighten',
    modes: [
      { value: 'lighten', label: 'Lighten' },
      { value: 'screen', label: 'Screen' },
      { value: 'color-dodge', label: 'Color Dodge' },
    ],
  },
  {
    label: 'Contrast',
    modes: [
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
    ],
  },
  {
    label: 'Comparative',
    modes: [
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
    ],
  },
  {
    label: 'Composite',
    modes: [
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' },
    ],
  },
];

const EFFECT_LIST: { key: EffectKey; label: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'innerGlow', label: 'Inner Glow' },
  { key: 'colorOverlay', label: 'Color Overlay' },
];

export function LayerEffectsPanel() {
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);
  const updateLayerEffects = useEditorStore((s) => s.updateLayerEffects);
  const updateLayerBlendMode = useEditorStore((s) => s.updateLayerBlendMode);
  const rasterizeLayerStyle = useEditorStore((s) => s.rasterizeLayerStyle);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);

  const [selectedEffect, setSelectedEffect] = useState<EffectKey>('dropShadow');

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const effects: LayerEffects | null = activeLayer?.effects ?? null;

  const update = useCallback(
    (partial: Partial<LayerEffects>) => {
      if (!activeLayerId || !effects) return;
      updateLayerEffects(activeLayerId, { ...effects, ...partial });
    },
    [activeLayerId, effects, updateLayerEffects],
  );

  const handleToggle = useCallback(
    (key: EffectKey) => {
      if (!effects) return;
      const current = effects[key];
      update({ [key]: { ...current, enabled: !current.enabled } });
    },
    [effects, update],
  );

  const handleBlendModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!activeLayerId) return;
      useEditorStore.getState().pushHistory('Change Blend Mode');
      updateLayerBlendMode(activeLayerId, e.target.value as BlendMode);
    },
    [activeLayerId, updateLayerBlendMode],
  );

  if (!activeLayer) {
    return (
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Layer Effects</span>
          <IconButton
            icon={<X size={14} />}
            label="Close effects"
            onClick={() => setShowEffectsDrawer(false)}
          />
        </div>
        <span className={styles.noLayer}>No layer selected</span>
      </div>
    );
  }

  const shadow = effects?.dropShadow;
  const stroke = effects?.stroke;
  const outerGlow = effects?.outerGlow;
  const innerGlow = effects?.innerGlow;
  const colorOverlay = effects?.colorOverlay;

  const hasAnyEffect = !!(
    shadow?.enabled || stroke?.enabled || outerGlow?.enabled || innerGlow?.enabled || colorOverlay?.enabled
  );

  function renderForm() {
    if (!effects) return null;
    const selected = effects[selectedEffect];
    if (!selected.enabled) return null;
    switch (selectedEffect) {
      case 'dropShadow':
        return shadow ? (
          <DropShadowForm shadow={shadow} onChange={(s) => update({ dropShadow: s })} />
        ) : null;
      case 'stroke':
        return stroke ? (
          <StrokeForm stroke={stroke} onChange={(s) => update({ stroke: s })} />
        ) : null;
      case 'outerGlow':
        return outerGlow ? (
          <GlowForm glow={outerGlow} onChange={(g) => update({ outerGlow: g })} />
        ) : null;
      case 'innerGlow':
        return innerGlow ? (
          <GlowForm glow={innerGlow} onChange={(g) => update({ innerGlow: g })} />
        ) : null;
      case 'colorOverlay':
        return colorOverlay ? (
          <ColorOverlayForm overlay={colorOverlay} onChange={(o) => update({ colorOverlay: o })} />
        ) : null;
      default:
        return null;
    }
  }

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>Layer Effects</span>
        <IconButton
          icon={<X size={14} />}
          label="Close effects"
          onClick={() => setShowEffectsDrawer(false)}
        />
      </div>
      <div className={styles.blendModeRow}>
        <span className={styles.fieldLabel}>Blend</span>
        <select
          className={styles.blendModeSelect}
          value={activeLayer.blendMode}
          onChange={handleBlendModeChange}
        >
          {BLEND_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className={styles.split}>
        <div className={styles.effectList}>
          {EFFECT_LIST.map(({ key, label }) => {
            const isEnabled = effects?.[key]?.enabled ?? false;
            const isSelected = selectedEffect === key;
            return (
              <div
                key={key}
                className={`${styles.effectRow} ${isSelected ? styles.effectRowSelected : ''}`}
                onClick={() => setSelectedEffect(key)}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isEnabled}
                  onChange={() => {
                    handleToggle(key);
                    setSelectedEffect(key);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={styles.effectLabel}>{label}</span>
              </div>
            );
          })}
          <div className={styles.effectListSpacer} />
          <button
            type="button"
            className={styles.rasterizeBtn}
            disabled={!hasAnyEffect}
            onClick={rasterizeLayerStyle}
          >
            Rasterize Layer Style
          </button>
        </div>
        <div className={styles.effectForm}>
          {renderForm() ?? (
            <span className={styles.hint}>
              Enable this effect to edit its properties.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
