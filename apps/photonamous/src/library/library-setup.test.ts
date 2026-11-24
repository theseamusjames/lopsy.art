import { describe, expect, it } from 'vitest';
import { librarySetup } from './library-setup';

const never = { lastSyncedAt: null, error: null };

describe('librarySetup', () => {
  it('is setting up while an empty library has not finished its first sync on this device', () => {
    expect(librarySetup(true, { ...never, state: 'idle' })).toEqual({ kind: 'setting-up' });
    expect(librarySetup(true, { ...never, state: 'syncing' })).toEqual({ kind: 'setting-up' });
  });

  it('is ready once it has synced, empty or not, and whenever it has photos to show', () => {
    expect(librarySetup(true, { state: 'idle', lastSyncedAt: '2026-11-23T10:00:00.000Z', error: null })).toEqual({ kind: 'ready' });
    expect(librarySetup(true, { state: 'syncing', lastSyncedAt: '2026-11-23T10:00:00.000Z', error: null })).toEqual({ kind: 'ready' });
    expect(librarySetup(false, { ...never, state: 'syncing' })).toEqual({ kind: 'ready' });
  });

  it('says why when the first sync cannot finish', () => {
    expect(librarySetup(true, { ...never, state: 'offline' })).toMatchObject({ kind: 'waiting', reason: expect.stringContaining('can’t be reached') });
    expect(librarySetup(true, { ...never, state: 'paused' })).toMatchObject({ kind: 'waiting', reason: expect.stringContaining('Sign in again') });
    expect(librarySetup(true, { state: 'error', lastSyncedAt: null, error: 'Drive is full.' })).toEqual({ kind: 'waiting', reason: 'Drive is full.' });
  });
});
