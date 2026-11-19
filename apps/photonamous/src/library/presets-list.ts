/** Edit and export presets as the UI lists them: Lopsy's own first, then the user's. Pure. */

import type { ExportPreset, LibraryView, Preset } from '@lopsy/photos-core/library/types';
import { BUILT_IN_EXPORT_PRESETS, BUILT_IN_PRESETS } from '@lopsy/photos-core/library/presets';

function byName<T extends { readonly name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export function listPresets(view: Pick<LibraryView, 'presets'>): Preset[] {
  return [...BUILT_IN_PRESETS, ...[...view.presets.values()].filter((p) => !p.deleted).sort(byName)];
}

export function listExportPresets(view: Pick<LibraryView, 'exportPresets'>): ExportPreset[] {
  return [...BUILT_IN_EXPORT_PRESETS, ...[...view.exportPresets.values()].filter((p) => !p.deleted).sort(byName)];
}
