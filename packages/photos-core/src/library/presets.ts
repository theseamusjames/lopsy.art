/**
 * Presets made for Lopsy (spec 5.4 Presets, 5.5). They live in code, are
 * never stored, and are listed next to the user's own. Their IDs start
 * with `builtin:` so they never collide with stored (UUID) presets.
 */

import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '../export/types';
import { groupOfPath, sanitizeRecipeValues, type RecipeGroupId } from './recipe';
import type { ExportPreset, Json, Preset } from './types';

export const BUILT_IN_PREFIX = 'builtin:';

function preset(id: string, name: string, values: Readonly<Record<string, Json>>): Preset {
  const clean = sanitizeRecipeValues(values);
  const groups = [...new Set(Object.keys(clean).map(groupOfPath))].filter((g): g is RecipeGroupId => g !== null);
  return { id: `${BUILT_IN_PREFIX}${id}`, name, groups, values: clean, createdAt: '', deleted: false, builtIn: true };
}

export const BUILT_IN_PRESETS: readonly Preset[] = [
  preset('punchy', 'Punchy', {
    'tone.contrast': 25,
    'tone.highlights': -20,
    'tone.shadows': 15,
    'tone.blacks': -10,
    'color.vibrance': 30,
    'color.saturation': 5,
    'localContrast.small': 20,
  }),
  preset('soft-matte', 'Soft matte', {
    'tone.contrast': -20,
    'tone.highlights': -15,
    'tone.blacks': 25,
    'color.saturation': -15,
    'curves.luminance': [
      { x: 0, y: 0.08 },
      { x: 0.5, y: 0.52 },
      { x: 1, y: 0.95 },
    ],
  }),
  preset('monochrome', 'Monochrome', {
    'profile.id': 'monochrome',
    'tone.contrast': 20,
    'tone.whites': 10,
    'tone.blacks': -10,
    'localContrast.large': 15,
  }),
  preset('warm', 'Warm', {
    'whiteBalance.mode': 'custom',
    'whiteBalance.temperature': 20,
    'whiteBalance.tint': 5,
    'color.vibrance': 10,
  }),
  preset('cool', 'Cool', {
    'whiteBalance.mode': 'custom',
    'whiteBalance.temperature': -20,
    'whiteBalance.tint': -3,
    'colorGrading.shadows.hue': 220,
    'colorGrading.shadows.saturation': 15,
  }),
];

function exportPreset(id: string, name: string, settings: ExportSettings): ExportPreset {
  return { id: `${BUILT_IN_PREFIX}${id}`, name, settings, createdAt: '', deleted: false, builtIn: true };
}

export const BUILT_IN_EXPORT_PRESETS: readonly ExportPreset[] = [
  exportPreset('full-jpeg', 'Full size JPEG', { ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', colorSpace: 'srgb', quality: 0.92 }),
  exportPreset('web-2048', 'Web, 2048 px, sRGB', {
    ...DEFAULT_EXPORT_SETTINGS,
    format: 'jpeg',
    colorSpace: 'srgb',
    quality: 0.85,
    maxLongEdge: 2048,
    metadata: 'copyright',
  }),
  exportPreset('tiff16-p3', '16-bit TIFF, Display P3', {
    ...DEFAULT_EXPORT_SETTINGS,
    format: 'tiff',
    colorSpace: 'display-p3',
    quality: 1,
  }),
];

/** A built-in or saved preset by ID; null when there is none or it was deleted. */
export function findPreset(presets: ReadonlyMap<string, Preset>, id: string): Preset | null {
  const found = id.startsWith(BUILT_IN_PREFIX) ? (BUILT_IN_PRESETS.find((p) => p.id === id) ?? null) : (presets.get(id) ?? null);
  return found && !found.deleted ? found : null;
}
