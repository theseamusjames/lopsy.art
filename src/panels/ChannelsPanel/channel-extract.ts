/**
 * Pure channel extraction utilities.
 * No DOM, no React — safe to import in unit tests and workers.
 */

export type ChannelId = 'r' | 'g' | 'b' | 'a';

/**
 * Extract a single RGBA channel from an ImageData and return it as a
 * grayscale ImageData of the same dimensions. The selected channel value
 * is mapped into R, G, and B; alpha is set to 255.
 */
export function extractChannel(source: ImageData, channel: ChannelId): ImageData {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(width * height * 4);

  const offset = channel === 'r' ? 0
    : channel === 'g' ? 1
    : channel === 'b' ? 2
    : 3;

  for (let i = 0; i < width * height; i++) {
    const srcBase = i * 4;
    const value = data[srcBase + offset]!;
    const dstBase = i * 4;
    out[dstBase] = value;
    out[dstBase + 1] = value;
    out[dstBase + 2] = value;
    out[dstBase + 3] = 255;
  }

  return new ImageData(out, width, height);
}
