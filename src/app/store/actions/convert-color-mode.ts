import type { DocumentState, DocumentColorMode, Color, Layer, LayerEffects } from '../../../types';
import type { ActionResult } from '../types';
import { convertColorToDocMode } from '../../../utils/color-mode';
import { getColorModeCapabilities, isAdjustmentAllowedInMode, HSL_BLEND_MODES } from '../../../utils/color-mode-capabilities';

function convertEffects(effects: LayerEffects, mode: DocumentColorMode): LayerEffects {
  const c = (color: Color): Color => convertColorToDocMode(color, mode);
  return {
    ...effects,
    stroke: { ...effects.stroke, color: c(effects.stroke.color) },
    dropShadow: { ...effects.dropShadow, color: c(effects.dropShadow.color) },
    outerGlow: { ...effects.outerGlow, color: c(effects.outerGlow.color) },
    innerGlow: { ...effects.innerGlow, color: c(effects.innerGlow.color) },
    colorOverlay: { ...effects.colorOverlay, color: c(effects.colorOverlay.color) },
  };
}

/**
 * Bring a layer's non-pixel color state into the target mode. Raster pixels are
 * baked on the GPU by the caller; this covers the descriptors the compositor
 * renders from (text/shape colors, effect colors) plus group adjustment nodes
 * that would otherwise reintroduce chroma the bake just removed.
 */
function convertLayerDescriptor(layer: Layer, mode: DocumentColorMode): Layer {
  const base = layer.effects
    ? { ...layer, effects: convertEffects(layer.effects, mode) }
    : { ...layer };

  // HSL-decomposing blend modes have no meaning once the texture stops holding
  // sRGB, so they fall back to Normal rather than compositing garbage.
  const withEffects =
    !getColorModeCapabilities(mode).hasHslBlendModes && HSL_BLEND_MODES.has(base.blendMode)
      ? ({ ...base, blendMode: 'normal' } as Layer)
      : base;

  if (withEffects.type === 'text') {
    return { ...withEffects, color: convertColorToDocMode(withEffects.color, mode) };
  }
  if (withEffects.type === 'shape') {
    return {
      ...withEffects,
      fill: withEffects.fill ? convertColorToDocMode(withEffects.fill, mode) : null,
      stroke: withEffects.stroke ? convertColorToDocMode(withEffects.stroke, mode) : null,
    };
  }
  if (withEffects.type === 'group') {
    const adjustments = withEffects.adjustments.filter((n) => isAdjustmentAllowedInMode(n.type, mode));
    return adjustments.length === withEffects.adjustments.length
      ? withEffects
      : { ...withEffects, adjustments };
  }
  return withEffects;
}

/**
 * Switch the document's color mode.
 *
 * Returns the store delta only — the caller runs `pushHistory` first (so the
 * pre-bake pixels are restorable) and then bakes each raster layer's GPU
 * texture, since pixel data lives on the GPU rather than in this result.
 * Returns `undefined` when the mode is unchanged.
 */
export function computeConvertColorMode(
  doc: DocumentState,
  newMode: DocumentColorMode,
): ActionResult | undefined {
  if (doc.colorMode === newMode) return undefined;
  return {
    document: {
      ...doc,
      colorMode: newMode,
      backgroundColor: convertColorToDocMode(doc.backgroundColor, newMode),
      layers: doc.layers.map((l) => convertLayerDescriptor(l, newMode)),
    },
  };
}

/** Every layer backed by a GPU texture — i.e. everything except groups. */
export function layersWithPixels(doc: DocumentState): string[] {
  return doc.layers.filter((l) => l.type !== 'group').map((l) => l.id);
}

/** Options the Indexed conversion dialog collects before the bake runs. */
export interface IndexedConversionOptions {
  readonly maxColors: number;
  readonly dither: boolean;
}

/** Unpack the engine's flat RGBA palette bytes into document palette entries. */
export function paletteFromBytes(bytes: Uint8Array): Color[] {
  const palette: Color[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    palette.push({ r: bytes[i]!, g: bytes[i + 1]!, b: bytes[i + 2]!, a: bytes[i + 3]! / 255 });
  }
  return palette;
}

/** Pack document palette entries back into the engine's flat RGBA bytes. */
export function paletteToBytes(palette: readonly Color[]): Uint8Array {
  const bytes = new Uint8Array(palette.length * 4);
  palette.forEach((c, i) => {
    bytes[i * 4] = c.r;
    bytes[i * 4 + 1] = c.g;
    bytes[i * 4 + 2] = c.b;
    bytes[i * 4 + 3] = Math.round(c.a * 255);
  });
  return bytes;
}
