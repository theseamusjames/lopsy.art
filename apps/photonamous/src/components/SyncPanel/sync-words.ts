import type { SyncStatus } from '@lopsy/photos-core/library/types';
import type { DownloadProgress } from '@lopsy/photos-core/cache/keep-originals';
import type { PreviewRefreshProgress } from '../../app/preview-refresh';

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

/** Keep originals: All, in the UI's words. */
export function describeDownload(progress: DownloadProgress): string {
  const count = `${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}`;
  const failed = progress.failed > 0 ? ` ${progress.failed.toLocaleString('en-US')} could not be downloaded.` : '';
  switch (progress.state) {
    case 'running':
      return `Downloading originals: ${count}`;
    case 'paused':
      return `Paused: ${count} originals on this device`;
    case 'full':
      return `Stopped: this device is nearly full. ${count} originals on this device.`;
    case 'done':
      return progress.failed > 0
        ? `${count} originals on this device.${failed}`
        : `All ${progress.total.toLocaleString('en-US')} originals are on this device.`;
    case 'stopped':
      return `${count} originals on this device`;
  }
}

/** Background previews, or null when there is nothing to say. */
export function describePreviewRefresh(progress: PreviewRefreshProgress): string | null {
  const failed = progress.failed > 0 ? ` ${progress.failed.toLocaleString('en-US')} could not be updated.` : '';
  if (progress.pending === 0) return failed === '' ? null : failed.trim();
  const count = `${progress.pending.toLocaleString('en-US')} ${progress.pending === 1 ? 'preview' : 'previews'}`;
  return progress.paused ? `${count} to update after editing.${failed}` : `Updating ${count}.${failed}`;
}

/** What to announce when saving changes state; null while changes merely wait, which they do after every edit. */
export function syncAnnouncement(status: SyncStatus): string | null {
  if (status.state === 'idle') return status.pendingOps > 0 ? null : describeSync(status);
  return describeSync(status);
}

/** What to announce about Keep originals: All. Only its state, not every original as it arrives. */
export function downloadAnnouncement(progress: DownloadProgress): string {
  return progress.state === 'running' ? 'Downloading originals…' : describeDownload(progress);
}

/** What to announce about background previews: only their state, not each one as it is made. */
export function previewAnnouncement(progress: PreviewRefreshProgress): string | null {
  if (progress.pending > 0 && !progress.paused && progress.failed === 0) return 'Updating previews…';
  return describePreviewRefresh(progress);
}
