import { describe, expect, it } from 'vitest';
import { photosUrlFor } from './photos-url';
import { activePhotosSession, type PhotosHandoffSession } from './photos-handoff-store';

describe('photosUrlFor', () => {
  it('is null unless the build sets VITE_PHOTOS_URL', () => {
    expect(photosUrlFor(undefined)).toBeNull();
    expect(photosUrlFor('  ')).toBeNull();
  });

  it('uses VITE_PHOTOS_URL', () => {
    expect(photosUrlFor('/photos/')).toBe('/photos/');
    expect(photosUrlFor(' https://photos.lopsy.art/ ')).toBe('https://photos.lopsy.art/');
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
