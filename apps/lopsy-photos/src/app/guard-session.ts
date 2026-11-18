/**
 * Wraps a LibrarySession so a command refused because another tab took
 * the library over (LibraryLockLostError), or because the library was made
 * by a newer app (LibraryReadOnlyError), shows a message instead of
 * throwing into a click handler.
 */

import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { LibraryLockLostError } from '@lopsy/photos-core/library/lock';
import { LibraryReadOnlyError } from '@lopsy/photos-core/library/session';

/** The session methods that change the library. */
export const COMMANDS: ReadonlySet<string> = new Set([
  'addAsset',
  'setMarks',
  'setKeyword',
  'deleteAssets',
  'restoreAssets',
  'createVersion',
  'renameVersion',
  'deleteVersion',
  'editRecipe',
  'setRecipe',
  'setPreview',
  'undo',
  'redo',
  'createAlbum',
  'renameAlbum',
  'deleteAlbum',
  'setAlbumMember',
  'setSetting',
]);

export const READ_ONLY_MESSAGE = 'This library was made by a newer version of Lopsy Photos, so it can only be looked at here.';

/** The message to show for a refused command, or null when the error is something else. */
export function refusalMessage(error: unknown): string | null {
  if (error instanceof LibraryLockLostError) return error.message;
  if (error instanceof LibraryReadOnlyError) return READ_ONLY_MESSAGE;
  return null;
}

export function guardSession(session: LibrarySession, onRefused: (message: string) => void): LibrarySession {
  return new Proxy(session, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || !COMMANDS.has(property) || typeof value !== 'function') {
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
      return (...args: unknown[]) => {
        try {
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (error) {
          const message = refusalMessage(error);
          if (message === null) throw error;
          onRefused(message);
          return undefined;
        }
      };
    },
  });
}
