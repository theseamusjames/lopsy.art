import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorageChoices } from './backend';

describe('browserStorageChoices', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser with the private file system and the folder picker. */
  function capableBrowser(): void {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => Promise.reject(new Error('not used')) } });
    vi.stubGlobal('window', { showDirectoryPicker: () => Promise.reject(new Error('not used')) });
  }

  it('offers only Google Drive when libraries on this computer are off, whatever the browser can do', () => {
    capableBrowser();
    expect(browserStorageChoices({ googleClientId: 'id', localLibraries: false })).toEqual(['google-drive']);
  });

  it('offers nothing in such a build without a Google client ID', () => {
    capableBrowser();
    expect(browserStorageChoices({ googleClientId: undefined, localLibraries: false })).toEqual([]);
  });

  it('adds what the browser supports when libraries on this computer are on', () => {
    capableBrowser();
    expect(browserStorageChoices({ googleClientId: 'id', localLibraries: true })).toEqual(['google-drive', 'browser', 'local-folder']);
    expect(browserStorageChoices({ googleClientId: undefined, localLibraries: true })).toEqual(['browser', 'local-folder']);
  });
});
