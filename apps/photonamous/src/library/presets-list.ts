/** Edit and export presets as the UI lists them: one list, by name. Pure. */

import type { ExportPreset, LibraryView, Preset } from '@lopsy/photos-core/library/types';
import { allExportPresets, allPresets } from '@lopsy/photos-core/library/presets';

function byName<T extends { readonly name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/**
 * The library's edit presets: the ones every library starts with and the
 * ones the user saved, together. The starters are the user's to rename
 * and delete like the rest, so nothing marks them out.
 */
export function listPresets(view: Pick<LibraryView, 'presets'>): Preset[] {
  return allPresets(view.presets).sort(byName);
}

export function listExportPresets(view: Pick<LibraryView, 'exportPresets'>): ExportPreset[] {
  return allExportPresets(view.exportPresets).sort(byName);
}
