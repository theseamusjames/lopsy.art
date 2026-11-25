import { describe, expect, it } from 'vitest';
import {
  parseHandoffDocument,
  parseCameraSummary,
  parseLopsyPing,
  parseLopsyReady,
  parsePhotosPong,
  parseLopsySave,
  parsePhotosDocument,
  parsePhotosSaved,
  parseSource,
} from './messages.ts';
import { LOPSY_BYTES, PNG_BYTES, bytes } from './fake-window.test-helper.ts';

const source = { libraryId: 'lib', assetId: 'a1', versionId: 'v1', recipeHash: 'h' };

describe('message validators', () => {
  it('accept a well-formed ready', () => {
    expect(parseLopsyReady({ protocol: 1, type: 'lopsy:ready', id: 'abc-1' })).toEqual({
      protocol: 1,
      type: 'lopsy:ready',
      id: 'abc-1',
    });
  });

  it('reject another protocol version, type or a bad id', () => {
    expect(parseLopsyReady({ protocol: 2, type: 'lopsy:ready', id: 'abc' })).toBeNull();
    expect(parseLopsyReady({ protocol: 1, type: 'photos:ready', id: 'abc' })).toBeNull();
    expect(parseLopsyReady({ protocol: 1, type: 'lopsy:ready', id: 'a b' })).toBeNull();
    expect(parseLopsyReady({ protocol: 1, type: 'lopsy:ready', id: 'x'.repeat(129) })).toBeNull();
    expect(parseLopsyReady(null)).toBeNull();
    expect(parseLopsyReady('lopsy:ready')).toBeNull();
  });

  it('check a document by kind and magic bytes', () => {
    const png = { name: 'DSCF1234', kind: 'png16', bytes: bytes(PNG_BYTES), source };
    expect(parseHandoffDocument(png)).toEqual(png);
    expect(parseHandoffDocument({ ...png, kind: 'lopsy' })).toBeNull();
    expect(parseHandoffDocument({ ...png, kind: 'jpeg' })).toBeNull();
    expect(parseHandoffDocument({ ...png, bytes: new Uint8Array(PNG_BYTES) })).toBeNull();
    expect(parseHandoffDocument({ ...png, bytes: new ArrayBuffer(0) })).toBeNull();
    expect(parseHandoffDocument({ ...png, name: '' })).toBeNull();
    expect(parseHandoffDocument({ ...png, name: 'n'.repeat(256) })).toBeNull();
    expect(parseHandoffDocument({ ...png, source: { libraryId: 'lib' } })).toBeNull();
    expect(parseHandoffDocument({ ...png, baseRevision: 7 })).toBeNull();
    expect(parseHandoffDocument({ name: 'p', kind: 'lopsy', bytes: bytes(LOPSY_BYTES), baseRevision: 'r1' })).toEqual({
      name: 'p',
      kind: 'lopsy',
      bytes: expect.any(ArrayBuffer),
      baseRevision: 'r1',
    });
  });

  it('drop unknown fields from a source block', () => {
    expect(parseSource({ ...source, extra: '<script>' })).toEqual(source);
  });

  it('check the envelope and payload of a photos:document', () => {
    const document = { name: 'p', kind: 'png16', bytes: bytes(PNG_BYTES) };
    expect(parsePhotosDocument({ protocol: 1, type: 'photos:document', id: 'i', document })?.document.name).toBe('p');
    expect(parsePhotosDocument({ protocol: 1, type: 'photos:document', id: 'i', document: { ...document, kind: 'raw' } })).toBeNull();
  });

  it('check both files of a save', () => {
    const save = {
      protocol: 1,
      type: 'lopsy:save',
      id: 'i',
      saveId: 's',
      name: 'p',
      lopsy: bytes(LOPSY_BYTES),
      render: bytes(PNG_BYTES),
    };
    expect(parseLopsySave(save)).not.toBeNull();
    expect(parseLopsySave({ ...save, lopsy: bytes(PNG_BYTES) })).toBeNull();
    expect(parseLopsySave({ ...save, render: bytes(LOPSY_BYTES) })).toBeNull();
    expect(parseLopsySave({ ...save, saveId: undefined })).toBeNull();
  });

  it('read a saved answer as ok or an error', () => {
    const base = { protocol: 1, type: 'photos:saved', id: 'i', saveId: 's' };
    expect(parsePhotosSaved({ ...base, ok: true, revision: 'r2' })).toEqual({ ...base, ok: true, revision: 'r2' });
    expect(parsePhotosSaved({ ...base, ok: false, error: 'Drive is full' })).toEqual({ ...base, ok: false, error: 'Drive is full' });
    expect(parsePhotosSaved({ ...base, ok: false })).toBeNull();
    expect(parsePhotosSaved({ ...base, ok: 'yes' })).toBeNull();
  });

  it('check ping, pong and document ids', () => {
    expect(parseLopsyPing({ protocol: 1, type: 'lopsy:ping', id: 'i' })).not.toBeNull();
    expect(parsePhotosPong({ protocol: 1, type: 'photos:pong', id: 'i' })).not.toBeNull();
    expect(parsePhotosPong({ protocol: 1, type: 'lopsy:ping', id: 'i' })).toBeNull();
    expect(parseSource({ ...source, documentId: 'doc-1' })).toEqual({ ...source, documentId: 'doc-1' });
    expect(parseSource({ ...source, documentId: 'not an id' })).toBeNull();
    const base = { protocol: 1, type: 'photos:saved', id: 'i', saveId: 's', ok: true };
    expect(parsePhotosSaved({ ...base, documentId: 'doc-1' })).toEqual({ ...base, documentId: 'doc-1' });
    expect(parsePhotosSaved({ ...base, documentId: 7 })).toBeNull();
  });

  it('check the camera summary', () => {
    const camera = { make: 'FUJIFILM', model: 'X-T5', iso: 400, aperture: 2.8, shutter: '1/250', capturedAt: '2026-11-14T16:02:11' };
    expect(parseCameraSummary({ ...camera, extra: 1 })).toEqual(camera);
    expect(parseCameraSummary({ iso: 'high' })).toBeNull();
    expect(parseCameraSummary({ iso: Number.NaN })).toBeNull();
    const png = { name: 'p', kind: 'png16', bytes: bytes(PNG_BYTES) };
    expect(parseHandoffDocument({ ...png, camera })?.camera).toEqual(camera);
    expect(parseHandoffDocument({ ...png, camera: { make: 7 } })).toBeNull();
  });
});
