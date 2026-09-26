import type { Layer, LayerEffects, TextLayer } from '../../../../types';
import { getEngine } from '../../../../engine-wasm/engine-state';
import { roundTo } from '../../../../utils/math';

type Engine = NonNullable<ReturnType<typeof getEngine>>;

interface LayerTransformHandlers {
  onText: (layer: Layer) => Layer;
  onRaster: (layer: Layer, engine: Engine | null) => Layer;
}

/**
 * A single scalar derived from a possibly non-uniform x/y scale, for
 * quantities that have no inherent axis (font size, stroke width, blur
 * radius, glow size) — the geometric mean keeps them proportionate to the
 * area change rather than picking one axis arbitrarily.
 */
export function isotropicScale(scaleX: number, scaleY: number): number {
  return Math.sqrt(scaleX * scaleY);
}

/**
 * Scales the size-like fields of a layer's effects for Image Size. Directional
 * fields (drop shadow offset) follow the matching axis; axis-less fields
 * (blur, spread, glow size, stroke width) use `isotropicScale` so a non-uniform
 * resize doesn't stretch them unevenly.
 */
export function scaleLayerEffects(
  effects: LayerEffects,
  scaleX: number,
  scaleY: number,
): LayerEffects {
  const scale = isotropicScale(scaleX, scaleY);
  return {
    ...effects,
    stroke: {
      ...effects.stroke,
      width: roundTo(effects.stroke.width * scale, 2),
    },
    dropShadow: {
      ...effects.dropShadow,
      offsetX: roundTo(effects.dropShadow.offsetX * scaleX, 2),
      offsetY: roundTo(effects.dropShadow.offsetY * scaleY, 2),
      blur: roundTo(effects.dropShadow.blur * scale, 2),
      spread: roundTo(effects.dropShadow.spread * scale, 2),
    },
    outerGlow: {
      ...effects.outerGlow,
      size: roundTo(effects.outerGlow.size * scale, 2),
      spread: roundTo(effects.outerGlow.spread * scale, 2),
    },
    innerGlow: {
      ...effects.innerGlow,
      size: roundTo(effects.innerGlow.size * scale, 2),
      spread: roundTo(effects.innerGlow.spread * scale, 2),
    },
  };
}

/**
 * Scales a text layer's position and type-specific size fields for Image
 * Size. `fontSize` and `letterSpacing` are axis-less font metrics (there is
 * no separate horizontal/vertical stretch of glyphs), so both use
 * `isotropicScale`. The area-text box `width` is a horizontal document-space
 * extent like a raster layer's width, so it follows `scaleX`.
 */
export function scaleTextLayerForResize(
  layer: TextLayer,
  scaleX: number,
  scaleY: number,
): TextLayer {
  const scale = isotropicScale(scaleX, scaleY);
  return {
    ...layer,
    x: Math.round(layer.x * scaleX),
    y: Math.round(layer.y * scaleY),
    fontSize: roundTo(layer.fontSize * scale, 2),
    letterSpacing: roundTo(layer.letterSpacing * scale, 2),
    width: layer.width === null ? null : Math.max(1, Math.round(layer.width * scaleX)),
    effects: scaleLayerEffects(layer.effects, scaleX, scaleY),
  };
}

/**
 * Iterates document layers and dispatches by type. Text and raster
 * layers are handled by the provided callbacks; groups and other
 * non-raster types pass through unchanged.
 */
export function mapLayersForTransform(
  layers: readonly Layer[],
  handlers: LayerTransformHandlers,
): Layer[] {
  const engine = getEngine();
  const result: Layer[] = [];

  for (const layer of layers) {
    if (layer.type === 'text') {
      result.push(handlers.onText(layer));
    } else if (layer.type === 'raster') {
      result.push(handlers.onRaster(layer, engine));
    } else {
      result.push(layer);
    }
  }

  return result;
}
