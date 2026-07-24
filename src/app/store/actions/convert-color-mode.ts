import type { DocumentState, DocumentColorMode, Color, Layer, LayerEffects } from '../../../types';
import type { ActionResult } from '../types';
import { convertColorToDocMode } from '../../../utils/color-mode';
import { isAdjustmentAllowedInMode } from '../../../utils/color-mode-capabilities';

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
  const withEffects = layer.effects
    ? { ...layer, effects: convertEffects(layer.effects, mode) }
    : { ...layer };

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

/** Raster layers whose GPU textures need a per-layer bake for this mode. */
export function layersNeedingPixelBake(doc: DocumentState, mode: DocumentColorMode): string[] {
  if (mode === 'rgb') return [];
  return doc.layers.filter((l) => l.type !== 'group').map((l) => l.id);
}
