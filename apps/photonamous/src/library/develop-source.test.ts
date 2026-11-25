import { describe, expect, it } from 'vitest';
import { developSource, isDevelopable } from './develop-source';
import { makeAsset } from './test-fixtures';

describe('developSource', () => {
  it('develops a photo from its own file', () => {
    const photo = makeAsset('a');
    expect(developSource(photo)).toBe(photo);
    expect(isDevelopable(photo)).toBe(true);
  });

  it('develops a Lopsy document from its flattened render, as a PNG', () => {
    const doc = makeAsset('d', { kind: 'document', fileId: 'lopsy-file', format: 'lopsy', mimeType: 'application/x-lopsy', renderFileId: 'render-file' });
    const source = developSource(doc);
    expect(source).toMatchObject({ id: 'd', kind: 'document', fileId: 'render-file', format: 'png', mimeType: 'image/png' });
    expect(isDevelopable(doc)).toBe(true);
    // Twice is the same: a source already pointing at the render stays on it.
    expect(developSource(source)).toEqual(source);
  });

  it('leaves a document without a render alone, and says it cannot be developed', () => {
    const doc = makeAsset('d', { kind: 'document', format: 'lopsy', renderFileId: null });
    expect(developSource(doc)).toBe(doc);
    expect(isDevelopable(doc)).toBe(false);
  });
});
