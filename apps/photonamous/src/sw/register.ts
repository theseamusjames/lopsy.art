/**
 * Registers the service worker in production builds (the dev server has
 * none), scoped to the app's base. A new version installs in the
 * background and waits; the user is told and reloads when they choose, so
 * a page never switches code under an open edit.
 *
 * Whether an update is waiting is read from this app's own registration,
 * never from `navigator.serviceWorker.controller`, which is null on a
 * first visit and changes when the first install claims the page. The page
 * reloads only after the user chose Reload, so a first install never
 * reloads it, for example in the middle of a handoff from Lopsy.
 */

import { showToast } from '../app/toasts';

/**
 * sw-logic.ts's SKIP_WAITING_MESSAGE, repeated: importing it would make the
 * worker and the page share a chunk, and the worker must bundle alone
 * (sw-logic.test.ts checks the two match).
 */
export const SKIP_WAITING = 'photonamous:skip-waiting';

/** sw-logic.ts's KEEP_FOR_OFFLINE_MESSAGE, repeated for the same reason. */
export const KEEP_FOR_OFFLINE = 'photonamous:keep-for-offline';

export const UPDATE_MESSAGE = 'New version ready';

/**
 * Asks the service worker to keep `url` for offline use: one of the files
 * it caches on demand, the engine's wasm for the build this page runs (the
 * install leaves both builds out). Production builds only; a page with no
 * worker yet asks once one is active.
 */
export function keepForOffline(url: string): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const path = new URL(url, location.href).pathname;
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: KEEP_FOR_OFFLINE, path }))
    .catch(() => undefined);
}

/** The parts of ServiceWorkerRegistration the update check reads. */
export interface RegistrationLike {
  readonly active: unknown;
  readonly waiting: unknown;
}

/** An update is waiting only when this app's own worker is active and a newer one has installed. */
export function hasWaitingUpdate(registration: RegistrationLike): boolean {
  return registration.active !== null && registration.waiting !== null;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  let reloadChosen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadChosen) return;
    reloadChosen = false;
    location.reload();
  });
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registration) => {
      const offer = (worker: ServiceWorker): void => {
        showToast(UPDATE_MESSAGE, null, {
          label: 'Reload',
          run: () => {
            reloadChosen = true;
            worker.postMessage(SKIP_WAITING);
          },
        });
      };
      if (registration.waiting && hasWaitingUpdate(registration)) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && registration.active !== null) offer(installing);
        });
      });
    })
    .catch((error: unknown) => console.warn('The offline app shell is unavailable', error));
}
