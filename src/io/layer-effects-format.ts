/**
 * Layer effects as stored in `.lopsy` manifests and Lopsy's private PSD
 * `lyEf` block, and the migration of effects saved before the drop shadow
 * and outer glow were cast from the stroked silhouette.
 *
 * Before that change both "behind" effects were built from the layer's own
 * alpha, and an outside / centre Stroke drawn on top hid the first `reach`
 * pixels of them. Now they are cast from the layer plus its stroke, so the
 * same settings would push the shadow `reach` px further out and start the
 * glow at full strength past the ring. Old files are rewritten on load so
 * they keep (nearly) their old look:
 *
 * - Drop shadow: each offset component moves back toward the layer by the
 *   reach (clamped at 0), so the shadow's leading edges land where they
 *   were. A component no larger than the reach was hidden under the stroke
 *   on that side, which is why 0 is the right floor. If even the leading
 *   side was partly hidden and the shadow is blurred, its opacity is scaled
 *   so the first pixel past the stroke is as dark as before.
 * - Outer glow: its extent cannot shrink without changing its falloff, so
 *   only its opacity is scaled, by the same rule: the first pixel past the
 *   stroke keeps its old strength. A glow the stroke used to hide entirely
 *   comes out at (near) zero opacity — as invisible as it was.
 */

import type { GlowEffect, LayerEffects, ShadowEffect, StrokeEffect } from '../types/effects';
import { DEFAULT_EFFECTS } from '../layers/layer-model';

/**
 * The first `.lopsy` format version — and `lyEf` effects version — whose
 * drop shadow and outer glow are cast from the stroked silhouette. Effects
 * from anything older are migrated by `migrateEffectsToStrokedSilhouette`.
 */
export const STROKED_SILHOUETTE_VERSION = 2;

/** Key in the PSD `lyEf` JSON recording which effects semantics wrote it. */
const PSD_EFFECTS_VERSION_KEY = 'effectsVersion';

/** Mirrors the engine's blur radius clamp (`blur_radius.min(63)`). */
const MAX_BLUR_RADIUS = 63;

/** Strokes reaching at most this far are drawn by a per-pixel distance search, wider ones by dilation. */
const DISTANCE_SEARCH_MAX_REACH = 10;

export function parseStoredEffects(raw: unknown): LayerEffects {
  if (!raw || typeof raw !== 'object') return DEFAULT_EFFECTS;
  const e = raw as Partial<LayerEffects>;
  return {
    stroke: e.stroke ?? DEFAULT_EFFECTS.stroke,
    dropShadow: e.dropShadow ?? DEFAULT_EFFECTS.dropShadow,
    outerGlow: e.outerGlow ?? DEFAULT_EFFECTS.outerGlow,
    innerGlow: e.innerGlow ?? DEFAULT_EFFECTS.innerGlow,
    colorOverlay: e.colorOverlay ?? DEFAULT_EFFECTS.colorOverlay,
  };
}

/**
 * Whole pixels the stroke's ring covers outside a straight edge of the
 * layer — what the engine actually draws, not the nominal width. The
 * distance search paints a pixel when its distance to the layer is at most
 * the reach (so `floor`); dilation runs at radius `ceil(reach)`. A stroke
 * that is disabled, inside, zero-width or fully transparent covers nothing.
 */
export function strokeSilhouetteReach(stroke: StrokeEffect): number {
  if (!stroke.enabled || stroke.width <= 0 || stroke.color.a <= 0) return 0;
  if (stroke.position === 'inside') return 0;
  const reach = stroke.position === 'center' ? stroke.width / 2 : stroke.width;
  return reach <= DISTANCE_SEARCH_MAX_REACH ? Math.floor(reach) : Math.ceil(reach);
}

/** `alpha^(1 − spread/100)`, as the shadow and glow shaders apply it. */
function spreadExponent(spread: number): number {
  return spread > 0.5 ? Math.max(1 - spread * 0.01, 0.001) : 1;
}

/**
 * How much weaker a blurred silhouette's edge is `hiddenPx` pixels further
 * out: the alpha of the first pixel past a straight edge that has moved
 * `hiddenPx` away, over the alpha of the first pixel past the edge itself,
 * through the spread curve. Uses the engine's Gaussian kernel (radius
 * `ceil(blur)` capped at 63, sigma = radius / 3). 1 when nothing is hidden
 * or there is no blur; 0 when the hidden band is wider than the kernel.
 */
export function blurredEdgeRatio(blur: number, hiddenPx: number, spread: number): number {
  const radius = Math.min(Math.ceil(blur), MAX_BLUR_RADIUS);
  if (radius <= 0 || hiddenPx <= 0) return 1;
  const sigma = radius / 3;
  // tail(k) ∝ Σ w_i for i ≥ k: the coverage of the k-th pixel past the edge.
  const tail = (k: number): number => {
    let sum = 0;
    for (let i = k; i <= radius; i++) sum += Math.exp(-(i * i) / (2 * sigma * sigma));
    return sum;
  };
  const first = tail(1);
  if (first <= 0) return 1;
  return Math.pow(tail(hiddenPx + 1) / first, spreadExponent(spread));
}

/** Move `offset` toward 0 by `reach`, never past it. */
export function pullOffsetBack(offset: number, reach: number): number {
  const pulled = Math.max(0, Math.abs(offset) - reach);
  return pulled === 0 ? 0 : Math.sign(offset) * pulled;
}

function migrateShadow(shadow: ShadowEffect, reach: number): ShadowEffect {
  const hiddenX = Math.max(0, reach - Math.abs(shadow.offsetX));
  const hiddenY = Math.max(0, reach - Math.abs(shadow.offsetY));
  const ratio = blurredEdgeRatio(shadow.blur, Math.round(Math.min(hiddenX, hiddenY)), shadow.spread);
  const migrated = {
    ...shadow,
    offsetX: pullOffsetBack(shadow.offsetX, reach),
    offsetY: pullOffsetBack(shadow.offsetY, reach),
  };
  if (ratio >= 1) return migrated;
  // Older files may lack `opacity`; the engine then uses the color's alpha.
  const opacity = (shadow.opacity as number | undefined) ?? shadow.color.a;
  return { ...migrated, opacity: opacity * ratio };
}

function migrateGlow(glow: GlowEffect, reach: number): GlowEffect {
  // The engine skips the blur below radius 2, leaving nothing outside the silhouette to match.
  if (Math.ceil(glow.size) < 2) return glow;
  const ratio = blurredEdgeRatio(glow.size, reach, glow.spread);
  return ratio >= 1 ? glow : { ...glow, opacity: glow.opacity * ratio };
}

/**
 * Rewrite effects saved before the drop shadow and outer glow included the
 * stroke so they render (nearly) as they did. Only an enabled shadow / glow
 * next to an enabled stroke that reaches outside the layer changes.
 */
export function migrateEffectsToStrokedSilhouette(effects: LayerEffects): LayerEffects {
  const reach = strokeSilhouetteReach(effects.stroke);
  if (reach <= 0) return effects;
  const isShadowAffected = effects.dropShadow.enabled;
  const isGlowAffected = effects.outerGlow.enabled;
  if (!isShadowAffected && !isGlowAffected) return effects;
  return {
    ...effects,
    dropShadow: isShadowAffected ? migrateShadow(effects.dropShadow, reach) : effects.dropShadow,
    outerGlow: isGlowAffected ? migrateGlow(effects.outerGlow, reach) : effects.outerGlow,
  };
}

/** Effects read from a file of `formatVersion`, migrated when it predates the stroked silhouette. */
export function effectsForFormatVersion(effects: LayerEffects, formatVersion: number): LayerEffects {
  return formatVersion < STROKED_SILHOUETTE_VERSION ? migrateEffectsToStrokedSilhouette(effects) : effects;
}

/** The PSD `lyEf` payload: the effects plus the semantics version that wrote them. */
export function serializePsdEffects(effects: LayerEffects): string {
  return JSON.stringify({ [PSD_EFFECTS_VERSION_KEY]: STROKED_SILHOUETTE_VERSION, ...effects });
}

/**
 * Parse a PSD `lyEf` payload. Blocks without a version were written before
 * the stroked silhouette and are migrated like a v1 `.lopsy`.
 */
export function parsePsdEffects(json: string | undefined): LayerEffects {
  if (!json) return DEFAULT_EFFECTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return DEFAULT_EFFECTS;
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_EFFECTS;
  const version = (parsed as Record<string, unknown>)[PSD_EFFECTS_VERSION_KEY];
  return effectsForFormatVersion(parseStoredEffects(parsed), typeof version === 'number' ? version : 1);
}
