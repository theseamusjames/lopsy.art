/**
 * Storybook support: an in-memory library (the `?backend=fake` one) opened
 * in the app's store, so components that read the library render without
 * real storage. Not part of the app.
 */

import type { Decorator } from '@storybook/react-vite';
import { setBackend } from '../app/backend-registry';
import { FakeBackend } from '../app/fake/fake-backend';
import { seedLibrary } from '../app/fake/fake-seed';
import { FakeSession } from '../app/fake/fake-session';
import { useUi } from '../app/store';

let library: FakeSession | null = null;
let driveLibrary: FakeSession | null = null;

/** The story library: 24 seeded photos, made once. */
export function fakeLibrary(): FakeSession {
  if (library === null) {
    setBackend(new FakeBackend(24));
    library = new FakeSession('browser', 'This browser');
    seedLibrary(library, 24);
  }
  return library;
}

/** The first `n` photos of the story library, by id. */
export function fakeAssetIds(n: number): string[] {
  return [...fakeLibrary().getView().assets.keys()].slice(0, n);
}

/** Opens the story library in the store before the story renders. */
export const withFakeLibrary: Decorator = (Story) => {
  const session = fakeLibrary();
  if (useUi.getState().connection?.session !== session) {
    useUi.getState().setConnection({ session, accountLabel: 'This browser' });
  }
  return <Story />;
};

/** Opens an empty Google Drive library in the store, for what Settings shows only for Drive. */
export const withFakeDriveLibrary: Decorator = (Story) => {
  fakeLibrary();
  driveLibrary ??= new FakeSession('google-drive', 'Google Drive');
  if (useUi.getState().connection?.session !== driveLibrary) {
    useUi.getState().setConnection({ session: driveLibrary, accountLabel: 'Google Drive' });
  }
  return <Story />;
};
