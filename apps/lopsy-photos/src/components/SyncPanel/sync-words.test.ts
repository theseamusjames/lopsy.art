import { describe, expect, it } from 'vitest';
import { describeDownload, describePreviewRefresh } from './sync-words';

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
