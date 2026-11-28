/**
 * Reconnect, wherever it is offered (the header, the import strip, the
 * single view, the Edit view, the export): one action, Google's window
 * from the click, then everything waiting for sign-in carries on by
 * itself. A second press while the window is open does nothing more.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { SignInState } from '@lopsy/photos-core/auth/types';
import { getBackend } from './backend-registry';
import { useSession } from './hooks';
import { useUi } from './store';
import { showToast } from './toasts';

let reconnecting = false;
const listeners = new Set<() => void>();
function setReconnecting(value: boolean): void {
  reconnecting = value;
  for (const listener of [...listeners]) listener();
}

/** Opens Google's window; call straight from a click (reauthorize asks before it awaits anything). */
export function reconnect(): void {
  const session = useUi.getState().connection?.session;
  if (!session || reconnecting) return;
  setReconnecting(true);
  getBackend()
    .reauthorize(session)
    .catch((error: unknown) => {
      console.warn('Google Drive was not reconnected', error);
      showToast(`${error instanceof Error ? error.message : String(error)} What waits for it carries on once you reconnect.`, 12_000);
    })
    .finally(() => setReconnecting(false));
}

export function useReconnecting(): boolean {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return useSyncExternalStore(subscribe, () => reconnecting);
}

/** Whether the open library's sign-in needs the person ('needed', 'renew') or not ('ok'). */
export function useSignInState(): SignInState {
  const session = useSession();
  const subscribe = useCallback((listener: () => void) => getBackend().subscribeSignIn(session, listener), [session]);
  return useSyncExternalStore(subscribe, () => getBackend().signInState(session));
}

/** What the header's Reconnect says it is for. */
export function signInWords(state: SignInState): string {
  if (state === 'needed') return 'Google Drive needs you to sign in again. Photos, originals and uploads wait until you reconnect.';
  if (state === 'renew') return 'Your Google sign-in ends soon and cannot be renewed without you. Reconnect to keep working.';
  return '';
}
