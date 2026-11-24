/**
 * Whether an empty library is really empty (pure). A device that opens a
 * library for the first time starts from its last snapshot, or from
 * nothing, and reads the rest in its first sync: until that has finished,
 * no photos does not mean there are none.
 */

import type { SyncStatus } from '@lopsy/photos-core/library/types';

export type LibrarySetup =
  /** Synced at least once here, or showing photos: what is on screen is the library. */
  | { readonly kind: 'ready' }
  /** The first sync is under way, or about to start. */
  | { readonly kind: 'setting-up' }
  /** The first sync cannot finish yet: `reason` says why, and what to do. */
  | { readonly kind: 'waiting'; readonly reason: string };

export function librarySetup(isEmpty: boolean, status: Pick<SyncStatus, 'state' | 'lastSyncedAt' | 'error'>): LibrarySetup {
  if (!isEmpty || status.lastSyncedAt !== null) return { kind: 'ready' };
  switch (status.state) {
    case 'idle':
    case 'syncing':
      return { kind: 'setting-up' };
    case 'offline':
      return { kind: 'waiting', reason: 'Your storage can’t be reached right now. Photonamous will keep trying.' };
    case 'paused':
      return { kind: 'waiting', reason: 'Sign in again to load it: the sync status at the top of the window has the button.' };
    case 'error':
      return { kind: 'waiting', reason: status.error ?? 'Something went wrong reading it. The sync status at the top of the window has more.' };
  }
}
