import type { EffectKey } from '../../app/effects-clipboard';
import { docScaledMax, docScaledOffset } from '../../utils/slider-ranges';

/** The effects drawer's list, in its order, with the labels its history entries use. */
export const EFFECT_LIST: { key: EffectKey; label: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'innerGlow', label: 'Inner Glow' },
  { key: 'colorOverlay', label: 'Color Overlay' },
];

export function effectLabel(key: EffectKey): string {
  return EFFECT_LIST.find((e) => e.key === key)?.label ?? 'Effect';
}

/** The largest values the effect forms' value boxes accept, in pixels, for a document of this size. */
export interface EffectSliderLimits {
  /** Drop shadow Offset X and Offset Y run from -shadowOffset to shadowOffset. */
  shadowOffset: number;
  shadowBlurMax: number;
  shadowSpreadMax: number;
  glowSizeMax: number;
  glowSpreadMax: number;
  /** Stroke Width runs from 1. */
  strokeWidthMax: number;
}

export function effectSliderLimits(docWidth: number, docHeight: number): EffectSliderLimits {
  return {
    shadowOffset: docScaledOffset(docWidth, docHeight, 100),
    shadowBlurMax: docScaledMax(docWidth, docHeight, 100),
    shadowSpreadMax: docScaledMax(docWidth, docHeight, 100),
    glowSizeMax: docScaledMax(docWidth, docHeight, 100),
    glowSpreadMax: docScaledMax(docWidth, docHeight, 100),
    strokeWidthMax: docScaledMax(docWidth, docHeight, 50),
  };
}
