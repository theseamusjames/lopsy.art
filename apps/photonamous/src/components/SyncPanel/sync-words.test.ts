import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@lopsy/photos-core/library/types';
import { describeDownload, describePreviewRefresh, downloadAnnouncement, previewAnnouncement, syncAnnouncement } from './sync-words';

const base = { total: 1200, done: 300, failed: 0, downloadedBytes: 0 };

describe('describeDownload', () => {
  it('says where the All download is', () => {
    expect(describeDownload({ ...base, state: 'running' })).toBe('Downloading originals: 300 of 1,200');
    expect(describeDownload({ ...base, state: 'paused' })).toBe('Paused: 300 of 1,200 originals on this device');
    expect(describeDownload({ ...base, state: 'full' })).toBe('Stopped: this device is nearly full. 300 of 1,200 originals on this device.');
    expect(describeDownload({ ...base, done: 1200, state: 'done' })).toBe('All 1,200 originals are on this device.');
    expect(describeDownload({ ...base, done: 1198, failed: 2, state: 'done' })).toBe('1,198 of 1,200 originals on this device. 2 could not be downloaded.');
  });
});

describe('describePreviewRefresh', () => {
  it('says how many previews are being updated', () => {
    expect(describePreviewRefresh({ pending: 0, paused: false, failed: 0 })).toBeNull();
    expect(describePreviewRefresh({ pending: 3, paused: false, failed: 0 })).toBe('Updating 3 previews.');
    expect(describePreviewRefresh({ pending: 1, paused: true, failed: 0 })).toBe('1 preview to update after editing.');
    expect(describePreviewRefresh({ pending: 0, paused: false, failed: 2 })).toBe('2 could not be updated.');
  });
});

describe('announcements', () => {
  const status = (state: SyncStatus['state'], pendingOps = 0): SyncStatus => ({ state, pendingOps, lastSyncedAt: null, error: null });

  it('says saving states, but not changes that merely wait', () => {
    expect(syncAnnouncement(status('idle'))).toBe('Everything is saved');
    expect(syncAnnouncement(status('idle', 3))).toBeNull();
    expect(syncAnnouncement(status('syncing', 3))).toBe('Saving…');
    expect(syncAnnouncement(status('offline', 2))).toBe('Offline — changes are kept and saved when the connection is back');
  });

  it('says a download or preview update has started, not each step of it', () => {
    expect(downloadAnnouncement({ ...base, state: 'running' })).toBe('Downloading originals…');
    expect(downloadAnnouncement({ ...base, done: 301, state: 'running' })).toBe('Downloading originals…');
    expect(downloadAnnouncement({ ...base, state: 'paused' })).toBe('Paused: 300 of 1,200 originals on this device');
    expect(previewAnnouncement({ pending: 3, paused: false, failed: 0 })).toBe('Updating previews…');
    expect(previewAnnouncement({ pending: 2, paused: false, failed: 0 })).toBe('Updating previews…');
    expect(previewAnnouncement({ pending: 0, paused: false, failed: 2 })).toBe('2 could not be updated.');
  });
});
