import { describe, it, expect } from 'vitest';
import { FONT_PREVIEWS_INDEX, FONT_PREVIEWS_TOTAL_BYTES } from './font-previews-index';

// The generator writes back-to-back WOFF2 subsets with no padding. If the
// generator regresses (holes, overlapping slices, or a size mismatch vs. the
// on-disk blob) the runtime will hand FontFace overlapping or truncated bytes
// and every affected preview will decode to garbage. Assert the invariants so
// a bad regeneration fails at build time.
describe('font-previews-index', () => {
  it('has at least one entry (blob was actually baked)', () => {
    expect(Object.keys(FONT_PREVIEWS_INDEX).length).toBeGreaterThan(0);
  });

  it('slices tile the blob contiguously with no gaps or overlaps', () => {
    const slices = Object.entries(FONT_PREVIEWS_INDEX)
      .map(([family, s]) => ({ family, ...s }))
      .sort((a, b) => a.offset - b.offset);

    let cursor = 0;
    for (const s of slices) {
      expect(s.offset, `hole/overlap before ${s.family}`).toBe(cursor);
      expect(s.length, `${s.family} has non-positive length`).toBeGreaterThan(0);
      cursor += s.length;
    }
    expect(cursor).toBe(FONT_PREVIEWS_TOTAL_BYTES);
  });

  it('exposes ubiquitous Google families the picker relies on being offline', () => {
    // These are the most commonly-picked Google-source families — if the
    // generator dropped them the picker's default landing view would fall
    // back to network requests. Inter is intentionally not on this list:
    // it's shipped as a system font (public/fonts/inter-*.woff2) and the
    // catalog flags it source: 'system', so it never needs a baked preview.
    for (const family of ['Roboto', 'Open Sans', 'Lato', 'Poppins', 'Montserrat']) {
      expect(FONT_PREVIEWS_INDEX[family], `${family} missing from baked previews`).toBeDefined();
    }
  });
});
