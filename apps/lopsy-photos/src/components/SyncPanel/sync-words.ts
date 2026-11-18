import type { SyncStatus } from '@lopsy/photos-core/library/types';

/** The sync state in the UI's words. */
export function describeSync(status: SyncStatus): string {
  switch (status.state) {
    case 'idle':
      return status.pendingOps > 0 ? 'Changes waiting to be saved' : 'Everything is saved';
    case 'syncing':
      return 'Saving…';
    case 'offline':
      return 'Offline — changes are kept and saved when the connection is back';
    case 'paused':
      return 'Sign in again to keep saving';
    case 'error':
      return 'Saving stopped';
  }
}

/** "just now", "5 minutes ago", or a date. */
export function formatWhen(iso: string | null, now = Date.now()): string {
  if (iso === null) return 'Not yet';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Unknown';
  const seconds = Math.round((now - t) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleString();
}
