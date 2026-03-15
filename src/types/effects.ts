import type { Color } from './color';

export interface LayerEffects {
  readonly stroke: StrokeEffect;
  readonly dropShadow: ShadowEffect;
  readonly outerGlow: GlowEffect;
  readonly innerGlow: GlowEffect;
}

export interface StrokeEffect {
  readonly enabled: boolean;
  readonly color: Color;
  readonly width: number; // pixels
  readonly position: 'outside' | 'inside' | 'center';
}

export interface ShadowEffect {
  readonly enabled: boolean;
  readonly color: Color;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
}

export interface GlowEffect {
  readonly enabled: boolean;
  readonly color: Color;
  readonly size: number;
  readonly spread: number;
  readonly opacity: number; // 0-1
}

export interface LayerMask {
  readonly id: string;
  readonly enabled: boolean;
  readonly data: Uint8ClampedArray; // grayscale mask, 0=transparent, 255=opaque
  readonly width: number;
  readonly height: number;
}
