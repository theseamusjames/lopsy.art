import type { StorageKind } from '@lopsy/photos-core/storage/types';

/**
 * Where the library lives, in the header's words. A Drive library says
 * only that: the app is never told whose Drive it is.
 */
export function describeWhere(kind: StorageKind, accountLabel: string): string {
  return kind === 'google-drive' ? 'Google Drive' : accountLabel;
}
