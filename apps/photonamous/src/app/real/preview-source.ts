/**
 * Where preview JPEGs come from. Today: straight from storage. The device
 * cache (photos-core/src/cache) replaces this with `setPreviewSource` once
 * it lands, without touching the UI; the UI's own LRU of object URLs
 * (app/preview-cache.ts) sits on top either way.
 */

import type { LibrarySession, PreviewRef } from '@lopsy/photos-core/library/types';

export interface PreviewSource {
  read(session: LibrarySession, ref: PreviewRef): Promise<Blob>;
}

const fromStorage: PreviewSource = {
  read: (session, ref) => session.adapter.readContent(ref.fileId),
};

let source: PreviewSource = fromStorage;

export function setPreviewSource(next: PreviewSource | null): void {
  source = next ?? fromStorage;
}

export function getPreviewSource(): PreviewSource {
  return source;
}
