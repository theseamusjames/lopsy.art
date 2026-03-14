import { useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../../components/Slider/Slider';
import { ColorSwatch } from '../../components/ColorSwatch/ColorSwatch';
import type { Color, LayerEffects, ShadowEffect, StrokeEffect, GlowEffect } from '../../types';
import styles from './LayerEffectsPanel.module.css';

const DEFAULT_SHADOW: ShadowEffect = {
  color: { r: 0, g: 0, b: 0, a: 0.75 },
  offsetX: 4,
  offsetY: 4,
  blur: 8,
  spread: 0,
};

const DEFAULT_STROKE: StrokeEffect = {
  color: { r: 0, g: 0, b: 0, a: 1 },
  width: 2,
  position: 'outside',
};

const DEFAULT_GLOW: GlowEffect = {
  color: { r: 255, g: 255, b: 100, a: 1 },
  size: 10,
  spread: 0,
  opacity: 0.75,
};

const DEFAULT_INNER_GLOW: GlowEffect = {
  color: { r: 255, g: 255, b: 100, a: 1 },
  size: 10,
  spread: 0,
  opacity: 0.75,
};

type StrokePosition = StrokeEffect['position'];

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

export function LayerEffectsPanel() {
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);
  const updateLayerEffects = useEditorStore((s) => s.updateLayerEffects);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const effects: LayerEffects | null = activeLayer?.effects ?? null;

  const update = useCallback(
    (partial: Partial<LayerEffects>) => {
      if (!activeLayerId || !effects) return;
      updateLayerEffects(activeLayerId, { ...effects, ...partial });
    },
    [activeLayerId, effects, updateLayerEffects],
  );

  if (!activeLayer) {
    return (
      <div className={styles.panel}>
        <span className={styles.noLayer}>No layer selected</span>
      </div>
    );
  }

  const hasDropShadow = effects?.dropShadow !== null;
  const hasStroke = effects?.stroke !== null;
  const hasGlow = effects?.outerGlow !== null;
  const hasInnerGlow = effects?.innerGlow !== null;

  const shadow = effects?.dropShadow ?? DEFAULT_SHADOW;
  const stroke = effects?.stroke ?? DEFAULT_STROKE;
  const glow = effects?.outerGlow ?? DEFAULT_GLOW;
  const innerGlow = effects?.innerGlow ?? DEFAULT_INNER_GLOW;

  const handleToggleDropShadow = () => {
    update({ dropShadow: hasDropShadow ? null : DEFAULT_SHADOW });
  };

  const handleToggleStroke = () => {
    update({ stroke: hasStroke ? null : DEFAULT_STROKE });
  };

  const handleToggleGlow = () => {
    update({ outerGlow: hasGlow ? null : DEFAULT_GLOW });
  };

  const handleToggleInnerGlow = () => {
    update({ innerGlow: hasInnerGlow ? null : DEFAULT_INNER_GLOW });
  };

  const handleShadowColor = (hex: string) => {
    if (!hasDropShadow) return;
    update({ dropShadow: { ...shadow, color: hexToColor(hex, shadow.color.a) } });
  };

  const handleStrokeColor = (hex: string) => {
    if (!hasStroke) return;
    update({ stroke: { ...stroke, color: hexToColor(hex, stroke.color.a) } });
  };

  const handleGlowColor = (hex: string) => {
    if (!hasGlow) return;
    update({ outerGlow: { ...glow, color: hexToColor(hex, glow.color.a) } });
  };

  const handleInnerGlowColor = (hex: string) => {
    if (!hasInnerGlow) return;
    update({ innerGlow: { ...innerGlow, color: hexToColor(hex, innerGlow.color.a) } });
  };

  const handleStrokePosition = (position: StrokePosition) => {
    if (!hasStroke) return;
    update({ stroke: { ...stroke, position } });
  };

  return (
    <div className={styles.panel}>
      {/* Drop Shadow */}
      <div className={styles.effectSection}>
        <label className={styles.effectHeader}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={hasDropShadow}
            onChange={handleToggleDropShadow}
          />
          <span className={styles.effectLabel}>Drop Shadow</span>
        </label>
        {hasDropShadow && (
          <div className={styles.effectBody}>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatch color={shadow.color} size="sm" />
              <input
                type="color"
                value={colorToHex(shadow.color)}
                onChange={(e) => handleShadowColor(e.target.value)}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Offset X</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={shadow.offsetX}
                  min={-100}
                  max={100}
                  onChange={(v) => update({ dropShadow: { ...shadow, offsetX: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Offset Y</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={shadow.offsetY}
                  min={-100}
                  max={100}
                  onChange={(v) => update({ dropShadow: { ...shadow, offsetY: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Blur</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={shadow.blur}
                  min={0}
                  max={100}
                  onChange={(v) => update({ dropShadow: { ...shadow, blur: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Spread</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={shadow.spread}
                  min={0}
                  max={100}
                  onChange={(v) => update({ dropShadow: { ...shadow, spread: v } })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stroke */}
      <div className={styles.effectSection}>
        <label className={styles.effectHeader}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={hasStroke}
            onChange={handleToggleStroke}
          />
          <span className={styles.effectLabel}>Stroke</span>
        </label>
        {hasStroke && (
          <div className={styles.effectBody}>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatch color={stroke.color} size="sm" />
              <input
                type="color"
                value={colorToHex(stroke.color)}
                onChange={(e) => handleStrokeColor(e.target.value)}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Width</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={stroke.width}
                  min={1}
                  max={50}
                  onChange={(v) => update({ stroke: { ...stroke, width: v } })}
                />
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
                    onClick={() => handleStrokePosition(pos)}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Outer Glow */}
      <div className={styles.effectSection}>
        <label className={styles.effectHeader}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={hasGlow}
            onChange={handleToggleGlow}
          />
          <span className={styles.effectLabel}>Outer Glow</span>
        </label>
        {hasGlow && (
          <div className={styles.effectBody}>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatch color={glow.color} size="sm" />
              <input
                type="color"
                value={colorToHex(glow.color)}
                onChange={(e) => handleGlowColor(e.target.value)}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Size</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={glow.size}
                  min={0}
                  max={100}
                  onChange={(v) => update({ outerGlow: { ...glow, size: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Spread</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={glow.spread}
                  min={0}
                  max={100}
                  onChange={(v) => update({ outerGlow: { ...glow, spread: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Opacity</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={Math.round(glow.opacity * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => update({ outerGlow: { ...glow, opacity: v / 100 } })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inner Glow */}
      <div className={styles.effectSection}>
        <label className={styles.effectHeader}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={hasInnerGlow}
            onChange={handleToggleInnerGlow}
          />
          <span className={styles.effectLabel}>Inner Glow</span>
        </label>
        {hasInnerGlow && (
          <div className={styles.effectBody}>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatch color={innerGlow.color} size="sm" />
              <input
                type="color"
                value={colorToHex(innerGlow.color)}
                onChange={(e) => handleInnerGlowColor(e.target.value)}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Size</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={innerGlow.size}
                  min={0}
                  max={100}
                  onChange={(v) => update({ innerGlow: { ...innerGlow, size: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Spread</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={innerGlow.spread}
                  min={0}
                  max={100}
                  onChange={(v) => update({ innerGlow: { ...innerGlow, spread: v } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.fieldLabel}>Opacity</span>
              <div className={styles.sliderWrap}>
                <Slider
                  value={Math.round(innerGlow.opacity * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => update({ innerGlow: { ...innerGlow, opacity: v / 100 } })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
