/**
 * Lopsy Photos' service worker (spec 5.7, 6.3): the app shell offline.
 * The build emits this file as `<base>sw.js` (scripts/vite-plugin-service-worker.ts)
 * and writes the precache manifest into `__PRECACHE_MANIFEST__`. It has no
 * imports left after bundling and no exports, so it runs as a classic
 * worker script in every browser.
 *
 * A new version installs and then waits; the page shows "New version
 * ready" and posts SKIP_WAITING_MESSAGE when the user chooses to reload.
 */

import { cacheName, planFetch, SKIP_WAITING_MESSAGE, staleCaches, type PrecacheManifest } from './sw-logic';

declare const __PRECACHE_MANIFEST__: PrecacheManifest;

/** The parts of ServiceWorkerGlobalScope used here (the DOM lib has no worker types). */
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface MessageEventLike extends Event {
  readonly data: unknown;
}

interface WorkerScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

const scope = self as unknown as WorkerScope;
const manifest = __PRECACHE_MANIFEST__;
const current = cacheName(manifest);

scope.addEventListener('install', (event) => {
  // `cache: 'reload'` skips the HTTP cache, so a new build never precaches an old file.
  event.waitUntil(
    caches.open(current).then((cache) => cache.addAll(manifest.files.map((path) => new Request(path, { cache: 'reload' })))),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCaches(names, current).map((name) => caches.delete(name))))
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING_MESSAGE) void scope.skipWaiting();
});

scope.addEventListener('fetch', (event) => {
  const plan = planFetch(event.request, scope.location.origin, manifest);
  if (plan.kind === 'pass') return;
  if (plan.kind === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const shell = await caches.match(plan.fallback, { cacheName: current });
        return shell ?? Response.error();
      }),
    );
    return;
  }
  event.respondWith(
    caches.match(plan.path, { cacheName: current }).then((hit) => hit ?? fetch(event.request)),
  );
});
