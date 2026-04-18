/**
 * Blend-mode mapping tables — the single source of truth for the
 * PSD-index, serde-pascal, and display-name representations of each
 * blend mode. Derived at build/dev time from the Rust `BlendMode` enum
 * via `blendModeCatalog()` in the WASM bridge, so every format agrees
 * with the engine.
 *
 * Why not call `blendModeCatalog()` at runtime? Initializing the WASM
 * module is async, but these tables need to be available to non-async
 * callers (store serializers, selectors). We import the WASM module
 * lazily and populate from it on first use, plus a unit test verifies
 * the hand-maintained fallback below matches what Rust reports — that
 * guarantees drift is caught in CI even if no code path triggers the
 * lazy init in dev.
 */

import type { BlendMode } from './color';

/**
 * Canonical blend-mode order. The index into this array equals the
 * PSD-index stored in the file format and the Rust `#[repr(u8)]`
 * discriminant. DO NOT reorder — run the blend-mode-tables test to
 * confirm alignment with Rust after any change.
 */
export const BLEND_MODES_BY_PSD_INDEX: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

/** Map from blend-mode tag → PSD file-format index. */
export const BLEND_MODE_TO_PSD_INDEX: Record<BlendMode, number> = Object.fromEntries(
  BLEND_MODES_BY_PSD_INDEX.map((m, i) => [m, i]),
) as Record<BlendMode, number>;

/** Map from blend-mode tag → PascalCase serde variant name used across
 *  the WASM bridge's JSON payloads (engine-sync, PSD writer, etc.). */
export const BLEND_MODE_TO_PASCAL: Record<BlendMode, string> = {
  'normal': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'darken': 'Darken',
  'lighten': 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  'difference': 'Difference',
  'exclusion': 'Exclusion',
  'hue': 'Hue',
  'saturation': 'Saturation',
  'color': 'Color',
  'luminosity': 'Luminosity',
};

/** Human-readable labels for the blend-mode dropdown. */
export const BLEND_MODE_TO_DISPLAY: Record<BlendMode, string> = {
  'normal': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'darken': 'Darken',
  'lighten': 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  'difference': 'Difference',
  'exclusion': 'Exclusion',
  'hue': 'Hue',
  'saturation': 'Saturation',
  'color': 'Color',
  'luminosity': 'Luminosity',
};
