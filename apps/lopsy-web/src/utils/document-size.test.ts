import { describe, it, expect } from 'vitest';
import { MAX_DOCUMENT_SIDE, clampDocumentSide, documentSizeLimit, maxDocumentSide } from './document-size';

describe('maxDocumentSide (#934)', () => {
  it('uses the GPU texture limit when it is below the hard cap', () => {
    expect(maxDocumentSide(8192)).toBe(8192);
  });

  it('never exceeds the hard cap', () => {
    expect(maxDocumentSide(32768)).toBe(MAX_DOCUMENT_SIDE);
  });

  it('falls back to the hard cap when the limit is unknown', () => {
    expect(maxDocumentSide(null)).toBe(MAX_DOCUMENT_SIDE);
    expect(maxDocumentSide(0)).toBe(MAX_DOCUMENT_SIDE);
  });
});

describe('clampDocumentSide', () => {
  it('clamps oversized requests to the max side', () => {
    expect(clampDocumentSide(16384, 8192)).toBe(8192);
    expect(clampDocumentSide(1200 * 300, 8192)).toBe(8192);
  });

  it('rounds and keeps at least 1 px', () => {
    expect(clampDocumentSide(99.6, 8192)).toBe(100);
    expect(clampDocumentSide(0, 8192)).toBe(1);
    expect(clampDocumentSide(Number.NaN, 8192)).toBe(1);
  });
});

describe('documentSizeLimit', () => {
  it('is the GPU\'s when the GPU allows no more than the cap', () => {
    expect(documentSizeLimit(8192)).toEqual({ side: 8192, isDevice: true });
    expect(documentSizeLimit(16384)).toEqual({ side: 16384, isDevice: true });
  });

  it('is Lopsy\'s cap when the GPU allows more, or its limit is unknown', () => {
    expect(documentSizeLimit(32768)).toEqual({ side: MAX_DOCUMENT_SIDE, isDevice: false });
    expect(documentSizeLimit(null)).toEqual({ side: MAX_DOCUMENT_SIDE, isDevice: false });
    expect(documentSizeLimit(0)).toEqual({ side: MAX_DOCUMENT_SIDE, isDevice: false });
  });
});
