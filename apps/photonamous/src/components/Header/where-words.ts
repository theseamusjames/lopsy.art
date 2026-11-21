import type { StorageKind } from '@lopsy/photos-core/storage/types';

/**
 * Where the library lives, in the header's words. A Drive library says so
 * without naming the account: whose Drive it is belongs in Settings, not
 * on screen the whole time.
 */
export function describeWhere(kind: StorageKind, accountLabel: string): string {
  return kind === 'google-drive' ? 'Google Drive' : accountLabel;
}
