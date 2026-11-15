import { test, expect } from './fixtures';
import type { Page, Download } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { waitForStore, createDocument, drawRect } from './helpers';

/**
 * ICC tagging / color conversion of exported files (wide-gamut sessions).
 *
 * On displays/browsers where the canvas runs in Display P3, exported pixel
 * values are P3-encoded. Readers assume sRGB unless the file carries a color
 * profile, so:
 *  - PNG/JPEG must carry exactly ONE real ICC profile (the encoder's own, or
 *    the Rust-built Display P3 profile as fallback) — historically a second,
 *    colorant-less junk profile was inserted before the encoder's, which
 *    readers picked up, producing desaturated output.
 *  - BMP cannot carry a profile, so pixels must be converted P3 → sRGB.
 *  - PSD must embed the Display P3 profile in image resource 1039.
 * In sRGB sessions everything keeps its sRGB tagging.
 */

/** Mirrors production feature detection (engine/color-space.ts). */
async function isWideGamutSession(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
      if (!ctx) return false;
      const img = new ImageData(1, 1, { colorSpace: 'display-p3' });
      img.data[0] = 255;
      img.data[3] = 255;
      ctx.putImageData(img, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).colorSpace === 'display-p3';
    } catch {
      return false;
    }
  });
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const readable = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function exportViaDialog(
  page: Page,
  format: 'PNG' | 'JPEG' | 'WebP' | 'BMP',
  pngQuality?: 'Regular' | 'High',
): Promise<Buffer> {
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Export…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: format, exact: true }).click();
  await page.waitForTimeout(100);
  if (pngQuality) {
    await dialog.getByRole('button', { name: pngQuality, exact: true }).click();
    await page.waitForTimeout(100);
  }

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  return downloadBytes(await downloadPromise);
}

// ─── PNG chunk parsing ─────────────────────────────────────────────────

interface PngChunk {
  type: string;
  payload: Buffer;
}

function parsePngChunks(buf: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    chunks.push({ type, payload: buf.subarray(off + 8, off + 8 + length) });
    off += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function pngColorChunks(buf: Buffer): PngChunk[] {
  return parsePngChunks(buf).filter((c) => ['iCCP', 'sRGB', 'cICP'].includes(c.type));
}

function inflateIccp(chunk: PngChunk): Buffer {
  const nameEnd = chunk.payload.indexOf(0);
  // nameEnd + 1 is the compression method byte (0 = deflate).
  return inflateSync(chunk.payload.subarray(nameEnd + 2));
}

// ─── ICC profile parsing ───────────────────────────────────────────────

/** Returns the (offset, size) of a tag in an ICC profile, or null. */
function findIccTag(profile: Buffer, sig: string): { offset: number; size: number } | null {
  const count = profile.readUInt32BE(128);
  for (let i = 0; i < count; i++) {
    const entry = 132 + i * 12;
    if (profile.subarray(entry, entry + 4).toString('latin1') === sig) {
      return { offset: profile.readUInt32BE(entry + 4), size: profile.readUInt32BE(entry + 8) };
    }
  }
  return null;
}

/** A usable display profile: valid magic plus colorimetry readers need. */
function expectRealRgbProfile(profile: Buffer) {
  expect(profile.subarray(36, 40).toString('latin1')).toBe('acsp');
  // The historical bug: a "profile" with only desc/wtpt/cprt tags — no
  // colorants, no TRC — which readers reject, falling back to sRGB.
  expect(findIccTag(profile, 'rXYZ'), 'profile must have colorant tags').not.toBeNull();
  expect(findIccTag(profile, 'rTRC'), 'profile must have tone curves').not.toBeNull();
}

// ─── JPEG segment parsing ──────────────────────────────────────────────

function jpegIccProfiles(buf: Buffer): Buffer[] {
  const profiles: Buffer[] = [];
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) break;
    const marker = buf[off + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
    const length = buf.readUInt16BE(off + 2) + 2;
    if (
      marker === 0xe2 &&
      buf.subarray(off + 4, off + 16).toString('latin1') === 'ICC_PROFILE\0'
    ) {
      // Skip the 2 chunk-numbering bytes after the identifier.
      profiles.push(buf.subarray(off + 18, off + length + 2));
    }
    off += length;
  }
  return profiles;
}

test.describe('Export color profiles (ICC)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
    // A saturated orange whose P3 → sRGB conversion is distinctive:
    // P3 (230, 120, 30) ≈ sRGB (246, 112, 0).
    await drawRect(page, 10, 10, 80, 80, { r: 230, g: 120, b: 30 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/export-color-profile-doc.png' });
  });

  test('PNG export carries exactly one real color profile', async ({ page }) => {
    const wideGamut = await isWideGamutSession(page);
    const buf = await exportViaDialog(page, 'PNG');

    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    const colorChunks = pngColorChunks(buf);
    expect(colorChunks, 'exactly one color chunk').toHaveLength(1);

    if (wideGamut) {
      expect(colorChunks[0]!.type).toBe('iCCP');
      expectRealRgbProfile(inflateIccp(colorChunks[0]!));
    } else {
      expect(['iCCP', 'sRGB']).toContain(colorChunks[0]!.type);
    }
  });

  test('high-quality 16-bit PNG embeds the corrected Display P3 profile', async ({ page }) => {
    const wideGamut = await isWideGamutSession(page);
    const buf = await exportViaDialog(page, 'PNG', 'High');

    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    const ihdr = parsePngChunks(buf).find((c) => c.type === 'IHDR')!;
    expect(ihdr.payload[8], '16-bit depth').toBe(16);

    const colorChunks = pngColorChunks(buf);
    expect(colorChunks, 'exactly one color chunk').toHaveLength(1);

    if (wideGamut) {
      expect(colorChunks[0]!.type).toBe('iCCP');
      expect(colorChunks[0]!.payload.subarray(0, 10).toString('latin1')).toBe('Display P3');
      const profile = inflateIccp(colorChunks[0]!);
      expectRealRgbProfile(profile);
      // Bradford-adapted P3 red colorant (X ≈ 0.51512). The old profile
      // shipped unadapted D65 colorants (X ≈ 0.4866) which shifted hues.
      const rxyz = findIccTag(profile, 'rXYZ')!;
      const redX = profile.readInt32BE(rxyz.offset + 8) / 65536;
      expect(redX).toBeGreaterThan(0.5);
      expect(redX).toBeLessThan(0.53);
    } else {
      expect(colorChunks[0]!.type).toBe('sRGB');
    }
  });

  test('JPEG export carries exactly one real ICC profile', async ({ page }) => {
    const wideGamut = await isWideGamutSession(page);
    const buf = await exportViaDialog(page, 'JPEG');

    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
    const profiles = jpegIccProfiles(buf);
    expect(profiles.length, 'at most one ICC profile').toBeLessThanOrEqual(1);
    if (wideGamut) {
      expect(profiles, 'wide-gamut JPEG must be tagged').toHaveLength(1);
      expectRealRgbProfile(profiles[0]!);
    }
  });

  test('BMP export converts wide-gamut pixels to sRGB', async ({ page }) => {
    const wideGamut = await isWideGamutSession(page);
    const buf = await exportViaDialog(page, 'BMP');

    expect(buf.subarray(0, 2).toString('latin1')).toBe('BM');
    const width = buf.readInt32LE(18);
    const height = buf.readInt32LE(22);
    expect(width).toBe(100);
    expect(height).toBe(100);

    // Sample the rect center at doc (50, 50). BMP rows are bottom-up, BGR.
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const off = 54 + (height - 1 - 50) * rowSize + 50 * 3;
    const b = buf[off]!;
    const g = buf[off + 1]!;
    const r = buf[off + 2]!;

    // P3 (230, 120, 30) converts to sRGB (246, 112, 0); without the
    // conversion the raw P3 values would leak through unchanged.
    const expected = wideGamut ? { r: 246, g: 112, b: 0 } : { r: 230, g: 120, b: 30 };
    expect(Math.abs(r - expected.r)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - expected.g)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - expected.b)).toBeLessThanOrEqual(3);
  });

  test('PSD export embeds the working-space ICC profile', async ({ page }) => {
    const wideGamut = await isWideGamutSession(page);

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export PSD' }).click();
    const buf = await downloadBytes(await downloadPromise);

    expect(buf.subarray(0, 4).toString('latin1')).toBe('8BPS');

    // Image resource 1039: 8BIM + id + empty pascal name + u32 size + data.
    const sig = Buffer.from([0x38, 0x42, 0x49, 0x4d, 0x04, 0x0f]); // "8BIM" + 1039
    const pos = buf.indexOf(sig);
    expect(pos, 'ICC image resource 1039 present').toBeGreaterThan(0);
    const size = buf.readUInt32BE(pos + 8);
    const profile = buf.subarray(pos + 12, pos + 12 + size);

    expect(profile.subarray(36, 40).toString('latin1')).toBe('acsp');
    if (wideGamut) {
      expect(profile.includes('Display P3'), 'P3 documents embed the Display P3 profile').toBe(
        true,
      );
      expectRealRgbProfile(profile);
    } else {
      expect(profile.includes('Display P3')).toBe(false);
    }
  });
});
