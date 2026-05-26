// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { classifyOpenFile } from './useDocumentOpenHandlers';

function makeFile(name: string, type = ''): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe('classifyOpenFile', () => {
  it('routes .lopsy files to the project loader (#542)', () => {
    expect(classifyOpenFile(makeFile('drawing.lopsy'))).toBe('lopsy');
    expect(classifyOpenFile(makeFile('DRAWING.LOPSY'))).toBe('lopsy');
  });

  it('routes .psd files to the PSD importer', () => {
    expect(classifyOpenFile(makeFile('photo.psd'))).toBe('psd');
  });

  it('routes .dng files to the DNG importer', () => {
    expect(classifyOpenFile(makeFile('raw.dng'))).toBe('dng');
  });

  it('routes generic image MIME types to the bitmap loader', () => {
    expect(classifyOpenFile(makeFile('photo.jpg', 'image/jpeg'))).toBe('image');
    expect(classifyOpenFile(makeFile('photo.png', 'image/png'))).toBe('image');
  });

  it('returns "unsupported" for non-image files with no special extension', () => {
    expect(classifyOpenFile(makeFile('notes.txt', 'text/plain'))).toBe('unsupported');
    expect(classifyOpenFile(makeFile('archive.zip', 'application/zip'))).toBe('unsupported');
  });

  it('prefers extension over MIME type so .lopsy with no type still routes', () => {
    // Browsers sometimes drop a .lopsy file with an empty MIME type.
    expect(classifyOpenFile(makeFile('drawing.lopsy', ''))).toBe('lopsy');
    expect(classifyOpenFile(makeFile('drawing.lopsy', 'application/octet-stream'))).toBe('lopsy');
  });
});
