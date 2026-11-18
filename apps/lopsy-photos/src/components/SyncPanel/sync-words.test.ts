import { describe, expect, it } from 'vitest';
import { describeDownload } from './sync-words';

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
