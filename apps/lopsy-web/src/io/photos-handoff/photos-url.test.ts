import { describe, expect, it } from 'vitest';
import { DEV_PHOTOS_URL, PRODUCTION_PHOTOS_URL, photosUrlFor } from './photos-url';
import { activePhotosSession, type PhotosHandoffSession } from './photos-handoff-store';

describe('photosUrlFor', () => {
  it('uses the Photos dev server in development and /photos/ in production', () => {
    expect(photosUrlFor(undefined, true)).toBe(DEV_PHOTOS_URL);
    expect(photosUrlFor(undefined, false)).toBe(PRODUCTION_PHOTOS_URL);
    expect(photosUrlFor('  ', false)).toBe(PRODUCTION_PHOTOS_URL);
  });

  it('prefers VITE_PHOTOS_URL', () => {
    expect(photosUrlFor('https://photos.lopsy.art/', true)).toBe('https://photos.lopsy.art/');
  });
});

describe('activePhotosSession', () => {
  const session: PhotosHandoffSession = { name: 'DSCF1234', documentId: 'doc-1', connection: { id: 'h', peer: null } };

  it('holds only while the editor shows the document the handoff opened', () => {
    expect(activePhotosSession(session, 'doc-1')).toBe(session);
    expect(activePhotosSession(session, 'doc-2')).toBeNull();
    expect(activePhotosSession(null, 'doc-1')).toBeNull();
  });
});
