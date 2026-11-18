/**
 * Picks the PhotosBackend for this page load. Only the fake exists until
 * the real one (photos-core's adapters, openLibrary and startImport) is
 * wired here. `?backend=fake` always picks the fake; `?seed=N` sets how
 * many photos it starts with.
 */

import type { PhotosBackend } from './backend';
import { FakeBackend } from './fake/fake-backend';

export type BackendName = 'fake';

export function chooseBackendName(search: string): BackendName {
  const params = new URLSearchParams(search);
  const asked = params.get('backend');
  if (asked === 'fake') return 'fake';
  return 'fake';
}

function seedCount(search: string): number {
  const raw = new URLSearchParams(search).get('seed');
  const n = raw === null ? 240 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(200_000, Math.floor(n)) : 240;
}

let backend: PhotosBackend | null = null;

export function getBackend(): PhotosBackend {
  if (backend === null) {
    const search = typeof location === 'undefined' ? '' : location.search;
    switch (chooseBackendName(search)) {
      case 'fake':
        backend = new FakeBackend(seedCount(search));
        break;
    }
  }
  if (backend === null) throw new Error('No backend');
  return backend;
}
