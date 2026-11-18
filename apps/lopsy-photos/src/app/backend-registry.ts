/**
 * Picks the PhotosBackend for this page load: the real one on photos-core
 * by default, the in-memory fake with `?backend=fake` (`&seed=N` sets how
 * many photos it starts with).
 */

import type { PhotosBackend } from './backend';
import { FakeBackend } from './fake/fake-backend';
import { RealBackend } from './real/real-backend';

export type BackendName = 'real' | 'fake';

export function chooseBackendName(search: string): BackendName {
  return new URLSearchParams(search).get('backend') === 'fake' ? 'fake' : 'real';
}

export function seedCount(search: string): number {
  const raw = new URLSearchParams(search).get('seed');
  const n = raw === null ? 240 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(200_000, Math.floor(n)) : 240;
}

let backend: PhotosBackend | null = null;

export function getBackend(): PhotosBackend {
  if (backend === null) {
    const search = typeof location === 'undefined' ? '' : location.search;
    backend = chooseBackendName(search) === 'fake' ? new FakeBackend(seedCount(search)) : new RealBackend();
  }
  return backend;
}
