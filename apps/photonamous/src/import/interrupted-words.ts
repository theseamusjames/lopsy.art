/**
 * What the interrupted-import notice says, from the summary
 * (photos-core import/interrupted.ts). Pure.
 */

import type { InterruptedImport } from '@lopsy/photos-core/import/interrupted';
import { plural } from './import-summary';

export function interruptedHeadline(summary: InterruptedImport): string {
  const missing = summary.missing.length;
  return `An import was interrupted: ${summary.imported.toLocaleString('en-US')} of ${plural(summary.total, 'photo')} imported, ${missing.toLocaleString('en-US')} not`;
}

export const INTERRUPTED_REMEDY = 'Choose the same photos or folder again: only the ones not imported are added.';

/** Said once, when the notice appears. */
export function interruptedAnnouncement(summary: InterruptedImport): string {
  return `Import interrupted: ${plural(summary.missing.length, 'photo')} not imported. Choose the same photos again to finish.`;
}

export const NOT_IMPORTED_FILE_NAME = 'photonamous-not-imported.txt';
