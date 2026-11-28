/** Reads what a reload left of imports into the store, for the open library. */

import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { getBackend } from '../app/backend-registry';
import { useUi } from '../app/store';

export function refreshInterruptedImport(session: LibrarySession): void {
  getBackend()
    .getInterruptedImport(session)
    .then((summary) => {
      if (useUi.getState().connection?.session === session) useUi.getState().setInterruptedImport(summary);
    })
    .catch((error: unknown) => console.warn('Interrupted imports could not be read', error));
}
