import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../../app/editor-store';
import { getColorModeCapabilities } from '../../utils/color-mode-capabilities';
import { useUIStore } from '../../app/ui-store';
import { IconButton } from '../../components/IconButton/IconButton';
import type { DragProps } from '../../app/hooks/useDraggablePanel';
import type { BlendMode, LayerEffects } from '../../types';
import { BlendModeSelect } from '../../components/BlendModeSelect/BlendModeSelect';
import { DropShadowForm } from './DropShadowForm';
import { StrokeForm } from './StrokeForm';
import { GlowForm } from './GlowForm';
import { ColorOverlayForm } from './ColorOverlayForm';
import styles from './LayerEffectsPanel.module.css';

type EffectKey = 'dropShadow' | 'stroke' | 'outerGlow' | 'innerGlow' | 'colorOverlay';

const EFFECT_LIST: { key: EffectKey; label: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'innerGlow', label: 'Inner Glow' },
  { key: 'colorOverlay', label: 'Color Overlay' },
];

interface LayerEffectsPanelProps {
  dragProps?: DragProps;
}

export function LayerEffectsPanel({ dragProps }: LayerEffectsPanelProps) {
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);
  const updateLayerEffects = useEditorStore((s) => s.updateLayerEffects);
  const updateLayerBlendMode = useEditorStore((s) => s.updateLayerBlendMode);
  const rasterizeLayerStyle = useEditorStore((s) => s.rasterizeLayerStyle);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);
  const colorMode = useEditorStore((s) => s.document.colorMode);

  const [selectedEffect, setSelectedEffect] = useState<EffectKey>('dropShadow');

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const effects: LayerEffects | null = activeLayer?.effects ?? null;

  // Modes whose textures no longer hold sRGB can't run the HSL-decomposing
  // blend modes, so those options are dropped rather than shown as no-ops.
  const allowHsl = getColorModeCapabilities(colorMode).hasHslBlendModes;

  // Live preview: update effects without creating undo entries (for slider drags)
  const updateLive = useCallback(
    (partial: Partial<LayerEffects>) => {
      if (!activeLayerId || !effects) return;
      updateLayerEffects(activeLayerId, { ...effects, ...partial }, true);
    },
    [activeLayerId, effects, updateLayerEffects],
  );

  const effectLabel = (key: EffectKey): string =>
    EFFECT_LIST.find((e) => e.key === key)?.label ?? 'Effect';

  // Committed update: apply effects change. History is pushed separately
  // by the caller (handleToggle, beginEffectsDrag) to avoid flooding the
  // undo stack — slider drags fire this dozens of times per second.
  const update = useCallback(
    (partial: Partial<LayerEffects>) => {
      if (!activeLayerId || !effects) return;
      updateLayerEffects(activeLayerId, { ...effects, ...partial }, true);
    },
    [activeLayerId, effects, updateLayerEffects],
  );

  // Push one undo entry at the START of a slider drag so undo restores
  // the pre-drag state (not the post-drag state).
  const beginEffectsDrag = useCallback(() => {
    useEditorStore.getState().pushHistoryMetadata(`Edit ${effectLabel(selectedEffect)}`);
  }, [selectedEffect]);

  const handleToggle = useCallback(
    (key: EffectKey) => {
      if (!effects) return;
      const current = effects[key];
      const verb = current.enabled ? 'Disable' : 'Enable';
      useEditorStore.getState().pushHistoryMetadata(`${verb} ${effectLabel(key)}`);
      update({ [key]: { ...current, enabled: !current.enabled } });
    },
    [effects, update],
  );

  const handleBlendModeChange = useCallback(
    (mode: BlendMode) => {
      if (!activeLayerId) return;
      useEditorStore.getState().pushHistoryMetadata('Change Blend Mode');
      updateLayerBlendMode(activeLayerId, mode);
    },
    [activeLayerId, updateLayerBlendMode],
  );

  if (!activeLayer) {
    return (
      <div className={styles.drawer}>
        <div className={styles.drawerHeader} {...dragProps}>
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
    switch (selectedEffect) {
      case 'dropShadow':
        return shadow ? (
          <DropShadowForm shadow={shadow} onChange={(s) => updateLive({ dropShadow: s })} onDragStart={beginEffectsDrag} />
        ) : null;
      case 'stroke':
        return stroke ? (
          <StrokeForm stroke={stroke} onChange={(s) => updateLive({ stroke: s })} onDragStart={beginEffectsDrag} />
        ) : null;
      case 'outerGlow':
        return outerGlow ? (
          <GlowForm glow={outerGlow} onChange={(g) => updateLive({ outerGlow: g })} onDragStart={beginEffectsDrag} />
        ) : null;
      case 'innerGlow':
        return innerGlow ? (
          <GlowForm glow={innerGlow} onChange={(g) => updateLive({ innerGlow: g })} onDragStart={beginEffectsDrag} />
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
      <div className={styles.drawerHeader} {...dragProps}>
        <span className={styles.drawerTitle}>Layer Effects</span>
        <IconButton
          icon={<X size={14} />}
          label="Close effects"
          onClick={() => setShowEffectsDrawer(false)}
        />
      </div>
      <BlendModeSelect
        value={activeLayer.blendMode}
        isGroup={activeLayer.type === 'group'}
        allowHsl={allowHsl}
        onChange={handleBlendModeChange}
      />
      <div className={styles.split}>
        <div className={styles.effectList} role="listbox" aria-label="Layer effects">
          {EFFECT_LIST.map(({ key, label }) => {
            const isEnabled = effects?.[key]?.enabled ?? false;
            const isSelected = selectedEffect === key;
            return (
              <div
                key={key}
                className={`${styles.effectRow} ${isSelected ? styles.effectRowSelected : ''}`}
                onClick={() => setSelectedEffect(key)}
                role="option"
                aria-selected={isSelected}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isEnabled}
                  aria-label={`Enable ${label}`}
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
