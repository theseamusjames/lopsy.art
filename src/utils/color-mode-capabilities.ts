import type { DocumentColorMode } from '../types/color-mode';
import type { AdjustmentNodeType } from '../types/adjustment-nodes';

/**
 * What a document color mode permits in the editor UI. A single source of
 * truth consulted by panels, menus, and tools so mode constraints are not
 * scattered as ad-hoc checks. All booleans are `true` for `rgb`.
 */
export interface ColorModeCapabilities {
  /** Color-producing / color-dependent adjustments (hue-sat, color balance, channel mixer, photo filter, gradient map). */
  readonly hasColorAdjustments: boolean;
  /** Saturation / vibrance adjustment node. */
  readonly hasSaturation: boolean;
  /** Per-channel R/G/B tabs in the Curves editor. */
  readonly hasCurveChannels: boolean;
  /** Per-channel R/G/B tabs in the Levels editor. */
  readonly hasLevelChannels: boolean;
  /** Multiple layers are supported (Indexed is a single flat document). */
  readonly hasLayers: boolean;
  /** New layers can be added (Indexed forbids it until converted back). */
  readonly canAddLayers: boolean;
  /** Gradient tool is available. */
  readonly hasGradients: boolean;
  /** Paint tools may anti-alias (Indexed forces hard edges). */
  readonly hasAntiAliasing: boolean;
  /**
   * Hue / Saturation / Color / Luminosity blend modes. These decompose RGB
   * into HSL, which is meaningless once a texture holds encoded Lab or ink
   * channels, so native modes drop them.
   */
  readonly hasHslBlendModes: boolean;
}

const RGB_CAPABILITIES: ColorModeCapabilities = {
  hasColorAdjustments: true,
  hasSaturation: true,
  hasCurveChannels: true,
  hasLevelChannels: true,
  hasLayers: true,
  canAddLayers: true,
  hasGradients: true,
  hasAntiAliasing: true,
  hasHslBlendModes: true,
};

// Grayscale/Lab/CMYK keep the layer stack and gradients but drop color-space
// controls that are meaningless without independent chroma channels.
const MONOCHROMATIC_CAPABILITIES: ColorModeCapabilities = {
  hasColorAdjustments: false,
  hasSaturation: false,
  hasCurveChannels: false,
  hasLevelChannels: false,
  hasLayers: true,
  canAddLayers: true,
  hasGradients: true,
  hasAntiAliasing: true,
  hasHslBlendModes: false,
};

// Indexed is a single flattened, palette-constrained surface: no layers, no
// gradients, no anti-aliasing, no color adjustments.
const INDEXED_CAPABILITIES: ColorModeCapabilities = {
  hasColorAdjustments: false,
  hasSaturation: false,
  hasCurveChannels: false,
  hasLevelChannels: false,
  hasLayers: false,
  canAddLayers: false,
  hasGradients: false,
  hasAntiAliasing: false,
  hasHslBlendModes: false,
};

const CAPABILITIES: Record<DocumentColorMode, ColorModeCapabilities> = {
  rgb: RGB_CAPABILITIES,
  grayscale: MONOCHROMATIC_CAPABILITIES,
  lab: MONOCHROMATIC_CAPABILITIES,
  cmyk: MONOCHROMATIC_CAPABILITIES,
  indexed: INDEXED_CAPABILITIES,
};

export function getColorModeCapabilities(mode: DocumentColorMode): ColorModeCapabilities {
  return CAPABILITIES[mode];
}

/** Blend modes that decompose RGB into HSL — see `hasHslBlendModes`. */
export const HSL_BLEND_MODES: ReadonlySet<string> = new Set([
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

/**
 * Adjustments that produce or manipulate chroma. They are hidden by modes
 * without `hasColorAdjustments`, and stripped from groups on conversion —
 * otherwise e.g. a Color Balance node would reintroduce color after a
 * grayscale bake.
 */
const COLOR_DEPENDENT_ADJUSTMENTS: ReadonlySet<AdjustmentNodeType> = new Set([
  'hue-saturation',
  'color-balance',
  'channel-mixer',
  'photo-filter',
  'gradient-map',
  'black-white',
]);

export function isAdjustmentAllowedInMode(
  type: AdjustmentNodeType,
  mode: DocumentColorMode,
): boolean {
  const caps = getColorModeCapabilities(mode);
  if (!caps.hasSaturation && type === 'saturation') return false;
  if (!caps.hasColorAdjustments && COLOR_DEPENDENT_ADJUSTMENTS.has(type)) return false;
  return true;
}
