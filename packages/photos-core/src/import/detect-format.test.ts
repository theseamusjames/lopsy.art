import { describe, expect, it } from 'vitest';
import { IMPORTABLE_MIME_TYPES, MIME_TYPES } from './detect-format';

describe('the MIME types a file picker is filtered to', () => {
  it('holds the type of every format import reads, so none is hidden from the picker', () => {
    for (const type of Object.values(MIME_TYPES)) expect(IMPORTABLE_MIME_TYPES).toContain(type);
  });

  it("names a Fujifilm RAW as the rest of the world does: Google's Picker shows a .RAF only when asked for this", () => {
    expect(MIME_TYPES.raf).toBe('image/x-fuji-raf');
    expect(IMPORTABLE_MIME_TYPES).toContain('image/x-fuji-raf');
  });

  it('includes the type of a file whose uploader did not say what it is, and nothing twice', () => {
    expect(IMPORTABLE_MIME_TYPES).toContain('application/octet-stream');
    expect(new Set(IMPORTABLE_MIME_TYPES).size).toBe(IMPORTABLE_MIME_TYPES.length);
  });
});
