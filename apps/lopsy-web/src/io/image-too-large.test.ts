import { describe, expect, it } from 'vitest';
import { assertFitsDocument, ImageTooLargeError, tooLargeFrom, tooLargeMessage } from './image-too-large';
import wgpuTexturePool from '../../../../engine/src/gpu/wgpu/texture_pool.rs?raw';
import webglTexturePool from '../../../../engine/src/gpu/webgl/texture_pool.rs?raw';

const DEVICE = { side: 16384, isDevice: true };
const CAP = { side: 16384, isDevice: false };

describe('tooLargeMessage', () => {
  it('says what, how large, why, and what to do', () => {
    expect(tooLargeMessage({ kind: 'image', name: 'ultrawide.jpg', width: 17504, height: 3440 }, DEVICE)).toEqual({
      title: 'This image is too large to open',
      body:
        "ultrawide.jpg is 17,504 × 3,440 pixels. Lopsy keeps each layer as one image in this device's graphics memory, " +
        'and the largest this device allows is 16,384 pixels on a side. Make the image smaller and open it again.',
    });
  });

  it('leaves the name out when there is none', () => {
    const { body } = tooLargeMessage({ kind: 'image', name: null, width: 9000, height: 600 }, { side: 8192, isDevice: true });
    expect(body).toMatch(/^The image is 9,000 × 600 pixels\. .* 8,192 pixels on a side\./);
  });

  it('words a paste as a paste', () => {
    expect(tooLargeMessage({ kind: 'paste', name: null, width: 9000, height: 600 }, DEVICE)).toEqual({
      title: 'This image is too large to paste',
      body:
        "The pasted image is 9,000 × 600 pixels. Lopsy keeps each layer as one image in this device's graphics memory, " +
        'and the largest this device allows is 16,384 pixels on a side. Make the image smaller and paste it again.',
    });
  });

  it('words a project as a project', () => {
    const { title, body } = tooLargeMessage({ kind: 'project', name: 'poster.lopsy', width: 12000, height: 9000 }, { side: 8192, isDevice: true });
    expect(title).toBe('This project is too large to open');
    expect(body).toBe(
      "poster.lopsy is 12,000 × 9,000 pixels. Lopsy keeps each layer as one image in this device's graphics memory, " +
        'and the largest this device allows is 8,192 pixels on a side. Open it on a device whose graphics allow larger images.',
    );
  });

  it("blames Lopsy's own cap, not the device, when the cap is what applies", () => {
    const { body } = tooLargeMessage({ kind: 'image', name: 'pano.png', width: 20000, height: 4000 }, CAP);
    expect(body).toBe(
      'pano.png is 20,000 × 4,000 pixels. Lopsy keeps each layer as one image, and the largest it allows is 16,384 pixels on a side. ' +
        'Make the image smaller and open it again.',
    );
    expect(body).not.toMatch(/device/);
  });
});

describe('assertFitsDocument', () => {
  it('lets through an image no larger than the limit on either side', () => {
    expect(() => assertFitsDocument(16384, 16384, DEVICE)).not.toThrow();
  });

  it('refuses one a pixel over on either side, with the reason as the message', () => {
    expect(() => assertFitsDocument(16385, 10, DEVICE)).toThrow(ImageTooLargeError);
    expect(() => assertFitsDocument(10, 16385, DEVICE)).toThrow(/^The image is 10 × 16,385 pixels\./);
  });
});

describe('tooLargeFrom', () => {
  it('reads the typed error', () => {
    expect(tooLargeFrom(new ImageTooLargeError(17504, 3440, DEVICE))).toEqual({ width: 17504, height: 3440, limit: DEVICE });
  });

  it("recognises the engine's refusal of a texture, as an Error or a string", () => {
    const expected = { width: 17504, height: 3440, limit: { side: 16384, isDevice: true } };
    expect(tooLargeFrom(new Error('texture 17504x3440 exceeds the GPU limit of 16384'))).toEqual(expected);
    expect(tooLargeFrom('upload failed: texture 17504x3440 exceeds the GPU limit of 16384')).toEqual(expected);
  });

  it('is null for any other failure', () => {
    expect(tooLargeFrom(new Error('Failed to open image: x.jpg'))).toBeNull();
    expect(tooLargeFrom(null)).toBeNull();
  });

  // The fallback reads the engine's words: a change to them in either build must be seen here.
  it.each([
    ['wgpu', wgpuTexturePool],
    ['webgl', webglTexturePool],
  ])("matches the words of the %s engine's texture pool", (_build, source) => {
    const format = /"texture \{width\}x\{height\} exceeds the GPU limit of \{[^}]*\}"/.exec(source);
    expect(format, `texture_pool.rs no longer says "texture {width}x{height} exceeds the GPU limit of {…}"`).not.toBeNull();
    const rendered = (format?.[0] ?? '').slice(1, -1).replace('{width}', '9000').replace('{height}', '600').replace(/\{[^}]*\}$/, '8192');
    expect(tooLargeFrom(new Error(rendered))).toEqual({ width: 9000, height: 600, limit: { side: 8192, isDevice: true } });
  });
});
