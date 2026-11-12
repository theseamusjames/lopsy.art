import type { FilterParam } from '../components/FilterDialog/FilterDialog';

/** Indices match `lopsy_core::filters::texture::TextureKind`. */
export const TEXTURE_KINDS = ['Grain', 'Rough', 'Canvas', 'Streaks', 'Cells'] as const;
/** Indices match `lopsy_core::filters::texture::TextureBlend`. */
export const TEXTURE_BLENDS = ['Light & Dark', 'Lighten', 'Darken', 'Relief'] as const;

export interface TextureArgs {
  kind: number;
  blend: number;
  amount: number;
  size: number;
  stretch: number;
  angleDegrees: number;
  detail: number;
  contrast: number;
  isColored: boolean;
  seed: number;
}

export const TEXTURE_DEFAULTS = {
  kind: 0,
  amount: 30,
  size: 3,
  detail: 40,
  stretch: 1,
  angle: 0,
  contrast: 0,
  blend: 0,
  color: 0,
  seed: 0,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function index(value: number | undefined, count: number): number {
  const i = Math.round(value ?? 0);
  return i >= 0 && i < count ? i : 0;
}

/** Maps dialog values (percent sliders, option indices) to engine units. */
export function textureArgs(values: Record<string, number>): TextureArgs {
  const d = TEXTURE_DEFAULTS;
  return {
    kind: index(values['kind'], TEXTURE_KINDS.length),
    blend: index(values['blend'], TEXTURE_BLENDS.length),
    amount: clamp(values['amount'] ?? d.amount, 0, 100) / 100,
    size: clamp(values['size'] ?? d.size, 1, 400),
    stretch: clamp(values['stretch'] ?? d.stretch, 1, 50),
    angleDegrees: clamp(values['angle'] ?? d.angle, 0, 360),
    detail: clamp(values['detail'] ?? d.detail, 0, 100) / 100,
    contrast: clamp(values['contrast'] ?? d.contrast, 0, 100) / 100,
    isColored: (values['color'] ?? d.color) === 1,
    seed: Math.round(clamp(values['seed'] ?? d.seed, 0, 999)),
  };
}

const options = (labels: readonly string[]) => labels.map((label, value) => ({ value, label }));

/** The Texture dialog's parameters, in display order. */
export const TEXTURE_PARAMS: FilterParam[] = [
  { key: 'kind', label: 'Type', min: 0, max: TEXTURE_KINDS.length - 1, defaultValue: TEXTURE_DEFAULTS.kind, options: options(TEXTURE_KINDS) },
  { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: TEXTURE_DEFAULTS.amount },
  { key: 'size', label: 'Size', min: 1, max: 200, step: 0.5, defaultValue: TEXTURE_DEFAULTS.size },
  { key: 'detail', label: 'Detail', min: 0, max: 100, step: 1, defaultValue: TEXTURE_DEFAULTS.detail },
  { key: 'stretch', label: 'Stretch', min: 1, max: 20, step: 0.1, defaultValue: TEXTURE_DEFAULTS.stretch },
  { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, defaultValue: TEXTURE_DEFAULTS.angle },
  { key: 'contrast', label: 'Contrast', min: 0, max: 100, step: 1, defaultValue: TEXTURE_DEFAULTS.contrast },
  { key: 'blend', label: 'Mode', min: 0, max: TEXTURE_BLENDS.length - 1, defaultValue: TEXTURE_DEFAULTS.blend, options: options(TEXTURE_BLENDS) },
  { key: 'color', label: 'Color', min: 0, max: 1, defaultValue: TEXTURE_DEFAULTS.color, options: options(['Mono', 'Colored']) },
  { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, defaultValue: TEXTURE_DEFAULTS.seed },
];
