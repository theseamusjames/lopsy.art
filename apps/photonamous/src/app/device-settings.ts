/** Settings that belong to this device, kept in localStorage. */

import { parseKeepOriginals, type KeepOriginals } from '@lopsy/photos-core/cache/keep-originals';

export type DriveAddMode = 'move' | 'leave';

export const KEEP_ORIGINALS_KEY = 'photonamous.keep-originals';

export function loadKeepOriginals(): KeepOriginals {
  try {
    return parseKeepOriginals(localStorage.getItem(KEEP_ORIGINALS_KEY));
  } catch {
    return parseKeepOriginals(null);
  }
}

export function saveKeepOriginals(mode: KeepOriginals): void {
  try {
    localStorage.setItem(KEEP_ORIGINALS_KEY, mode);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

export const DRIVE_ADD_KEY = 'photonamous.drive-add';

/** Files added from Drive move into Originals/ unless the user chose to leave them where they are. */
export function parseDriveAddMode(raw: string | null): DriveAddMode {
  return raw === 'leave' ? 'leave' : 'move';
}

export function loadDriveAddMode(): DriveAddMode {
  try {
    return parseDriveAddMode(localStorage.getItem(DRIVE_ADD_KEY));
  } catch {
    return 'move';
  }
}

export function saveDriveAddMode(mode: DriveAddMode): void {
  try {
    localStorage.setItem(DRIVE_ADD_KEY, mode);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/** The words for a repair's findings. */
export function describeHealth(report: {
  readonly assetsChecked: number;
  readonly missing: readonly string[];
  readonly trashed: readonly string[];
  readonly changed: readonly string[];
  readonly orphans: readonly string[];
  readonly leftovers?: readonly string[];
}): string[] {
  const lines: string[] = [];
  const n = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
  if (report.missing.length > 0) lines.push(`${n(report.missing.length, 'original is', 'originals are')} missing from storage.`);
  if (report.trashed.length > 0) lines.push(`${n(report.trashed.length, 'original is', 'originals are')} in the trash.`);
  if (report.changed.length > 0) lines.push(`${n(report.changed.length, 'original has', 'originals have')} been changed outside Lopsy Photos.`);
  if (report.orphans.length > 0) lines.push(`${n(report.orphans.length, 'photo is', 'photos are')} in Originals but not in the library.`);
  const leftovers = report.leftovers?.length ?? 0;
  if (leftovers > 0) lines.push(`${n(leftovers, 'original of a deleted photo is', 'originals of deleted photos are')} still outside the trash.`);
  if (lines.length === 0) lines.push(`All ${n(report.assetsChecked, 'original is', 'originals are')} where they should be.`);
  return lines;
}
