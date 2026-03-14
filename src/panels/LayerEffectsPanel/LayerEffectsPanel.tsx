import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import type { Color, LayerEffects, ShadowEffect, StrokeEffect, GlowEffect } from '../../types';
import styles from './LayerEffectsPanel.module.css';

type EffectKey = 'dropShadow' | 'stroke' | 'outerGlow' | 'innerGlow';
type StrokePosition = StrokeEffect['position'];

const EFFECT_LIST: { key: EffectKey; label: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'innerGlow', label: 'Inner Glow' },
];

function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, '0');
  const g = c.g.toString(16).padStart(2, '0');
  const b = c.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToColor(hex: string, alpha: number): Color {
  const val = hex.replace('#', '');
  return {
    r: parseInt(val.slice(0, 2), 16),
    g: parseInt(val.slice(2, 4), 16),
    b: parseInt(val.slice(4, 6), 16),
    a: alpha,
  };
}

function DropShadowForm({
  shadow,
  onChange,
}: {
  shadow: ShadowEffect;
  onChange: (s: ShadowEffect) => void;
}) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${shadow.color.r}, ${shadow.color.g}, ${shadow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(shadow.color)}
            onChange={(e) => onChange({ ...shadow, color: hexToColor(e.target.value, shadow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Offset X</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.offsetX} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetX: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Offset Y</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.offsetY} min={-100} max={100} onChange={(v) => onChange({ ...shadow, offsetY: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Blur</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.blur} min={0} max={100} onChange={(v) => onChange({ ...shadow, blur: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Spread</span>
        <div className={styles.sliderWrap}>
          <Slider value={shadow.spread} min={0} max={100} onChange={(v) => onChange({ ...shadow, spread: v })} />
        </div>
      </div>
    </>
  );
}

function StrokeForm({
  stroke,
  onChange,
}: {
  stroke: StrokeEffect;
  onChange: (s: StrokeEffect) => void;
}) {
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
              onClick={() => onChange({ ...stroke, position: pos as StrokePosition })}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function GlowForm({
  glow,
  onChange,
}: {
  glow: GlowEffect;
  onChange: (g: GlowEffect) => void;
}) {
  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ backgroundColor: `rgb(${glow.color.r}, ${glow.color.g}, ${glow.color.b})` }}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(glow.color)}
            onChange={(e) => onChange({ ...glow, color: hexToColor(e.target.value, glow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Size</span>
        <div className={styles.sliderWrap}>
          <Slider value={glow.size} min={0} max={100} onChange={(v) => onChange({ ...glow, size: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Spread</span>
        <div className={styles.sliderWrap}>
          <Slider value={glow.spread} min={0} max={100} onChange={(v) => onChange({ ...glow, spread: v })} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Opacity</span>
        <div className={styles.sliderWrap}>
          <Slider
            value={Math.round(glow.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...glow, opacity: v / 100 })}
          />
        </div>
      </div>
    </>
  );
}

export function LayerEffectsPanel() {
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);
  const updateLayerEffects = useEditorStore((s) => s.updateLayerEffects);
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
