/**
 * Registers the service worker in production builds (the dev server has
 * none), scoped to the app's base. A new version installs in the
 * background and waits; the user is told and reloads when they choose, so
 * a page never switches code under an open edit.
 */

import { showToast } from '../app/toasts';

/**
 * sw-logic.ts's SKIP_WAITING_MESSAGE, repeated: importing it would make the
 * worker and the page share a chunk, and the worker must bundle alone
 * (sw-logic.test.ts checks the two match).
 */
export const SKIP_WAITING = 'lopsy-photos:skip-waiting';

export const UPDATE_MESSAGE = 'New version ready';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claims the page too; only a chosen update reloads.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registration) => {
      const offer = (worker: ServiceWorker): void => {
        showToast(UPDATE_MESSAGE, null, { label: 'Reload', run: () => worker.postMessage(SKIP_WAITING) });
      };
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) offer(installing);
        });
      });
    })
    .catch((error: unknown) => console.warn('The offline app shell is unavailable', error));
}
