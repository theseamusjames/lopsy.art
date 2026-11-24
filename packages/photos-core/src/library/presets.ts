/**
 * The presets every library starts with (spec 5.4 Presets, 5.5). They are
 * the user's to manage like any they save: listed with their own as one
 * list, renamed and deleted the same way.
 *
 * They live in code rather than being written into each new library, so
 * two devices cannot both seed them and no library goes without. A
 * library says what its user did with one in a record under its ID: a new
 * name, or `deleted`. What a starter does (its values, its settings) is
 * always what the code here says: a stored record cannot change that.
 * Their IDs start with `builtin:` so they never collide with saved (UUID)
 * presets.
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
    size: { mode: 'long', px: 2048 },
    metadata: 'copyright',
  }),
  exportPreset('tiff16-p3', '16-bit TIFF, Display P3', {
    ...DEFAULT_EXPORT_SETTINGS,
    format: 'tiff',
    colorSpace: 'display-p3',
    quality: 1,
  }),
];

/** The name and `deleted` a library holds for a starter, laid over the starter itself. */
function withUserChanges<T extends { readonly name: string; readonly deleted: boolean }>(starter: T, stored: T | undefined): T {
  return stored ? { ...starter, name: stored.name, deleted: stored.deleted } : starter;
}

function starterOr<T extends { readonly id: string; readonly name: string; readonly deleted: boolean }>(
  starters: readonly T[],
  stored: ReadonlyMap<string, T>,
  id: string,
): T | null {
  if (!id.startsWith(BUILT_IN_PREFIX)) return stored.get(id) ?? null;
  const starter = starters.find((p) => p.id === id);
  return starter ? withUserChanges(starter, stored.get(id)) : null;
}

function listed<T extends { readonly id: string; readonly name: string; readonly deleted: boolean }>(starters: readonly T[], stored: ReadonlyMap<string, T>): T[] {
  const all = starters.map((starter) => withUserChanges(starter, stored.get(starter.id)));
  for (const preset of stored.values()) if (!preset.id.startsWith(BUILT_IN_PREFIX)) all.push(preset);
  return all.filter((preset) => !preset.deleted);
}

/** A starter or saved preset by ID, as the library has it; null when there is none or it was deleted. */
export function findPreset(presets: ReadonlyMap<string, Preset>, id: string): Preset | null {
  const found = starterOr(BUILT_IN_PRESETS, presets, id);
  return found && !found.deleted ? found : null;
}

/** Whether `id` is one of the starters. */
export function isStarterPreset(id: string): boolean {
  return BUILT_IN_PRESETS.some((p) => p.id === id);
}

export function isStarterExportPreset(id: string): boolean {
  return BUILT_IN_EXPORT_PRESETS.some((p) => p.id === id);
}

/** Every edit preset a library has: the starters its user has not deleted (under the names they gave them) and the ones they saved. */
export function allPresets(stored: ReadonlyMap<string, Preset>): Preset[] {
  return listed(BUILT_IN_PRESETS, stored);
}

/** Every export preset a library has, as `allPresets`. */
export function allExportPresets(stored: ReadonlyMap<string, ExportPreset>): ExportPreset[] {
  return listed(BUILT_IN_EXPORT_PRESETS, stored);
}
