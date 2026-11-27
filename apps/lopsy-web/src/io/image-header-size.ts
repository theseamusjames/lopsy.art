/**
 * An image's size read from its file's header, before anything decodes it,
 * so a file too large to open here (io/image-too-large.ts) is refused before
 * a document is made. Only the header is read: no pixels. Each returns null
 * when the bytes are not that format or the header cannot be read; the
 * caller then lets the decoder decide, as before.
 */

/** A PNG's size, from its IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  // The first chunk is IHDR: its length (13) and type at 8, width and height at 16 and 20, big-endian.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

const TAG = {
  newSubFileType: 254,
  imageWidth: 256,
  imageLength: 257,
  photometric: 262,
  orientation: 274,
  subIfds: 330,
  defaultScale: 50718,
  defaultCropOrigin: 50719,
  defaultCropSize: 50720,
  activeArea: 50829,
} as const;

type Ifd = ReadonlyMap<number, readonly number[]>;

/** A TIFF's IFDs as tag → numeric values (rationals as their quotient). Throws on bytes it cannot read. */
function tiffReader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF');
  const little = order === 'II';
  if (view.getUint16(2, little) !== 42) throw new Error('not a TIFF');

  const value = (type: number, at: number): number => {
    switch (type) {
      case 3: return view.getUint16(at, little);
      case 4: case 13: return view.getUint32(at, little);
      case 8: return view.getInt16(at, little);
      case 9: return view.getInt32(at, little);
      case 5: return view.getUint32(at, little) / view.getUint32(at + 4, little);
      case 10: return view.getInt32(at, little) / view.getInt32(at + 4, little);
      case 11: return view.getFloat32(at, little);
      case 12: return view.getFloat64(at, little);
      default: return view.getUint8(at);
    }
  };

  const readIfd = (offset: number): Ifd => {
    const entries = new Map<number, number[]>();
    const count = view.getUint16(offset, little);
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      const tag = view.getUint16(at, little);
      const type = view.getUint16(at + 2, little);
      const n = view.getUint32(at + 4, little);
      const size = TYPE_SIZES[type];
      // Only the tags read here, and never a long list: a header has no reason to hold one.
      if (size === undefined || n === 0 || n > 64 || !Object.values(TAG).includes(tag as never)) continue;
      const start = n * size <= 4 ? at + 8 : view.getUint32(at + 8, little);
      entries.set(tag, Array.from({ length: n }, (_, k) => value(type, start + k * size)));
    }
    return entries;
  };

  return { ifd0: readIfd(view.getUint32(4, little)), readIfd };
}

const first = (ifd: Ifd, tag: number): number | undefined => ifd.get(tag)?.[0];
const pixelCount = (ifd: Ifd) => (first(ifd, TAG.imageWidth) ?? 0) * (first(ifd, TAG.imageLength) ?? 0);

/**
 * A DNG's size as Lopsy's DNG import opens it (the engine's `read_dng`):
 * the main raw image (the largest full-resolution CFA or linear raw IFD,
 * else the largest sub-IFD, else IFD0), its `ActiveArea`, the `DefaultCrop`
 * inside it when that is whole pixels at a `DefaultScale` of 1, and the
 * orientation, which swaps the sides for 5 to 8.
 */
export function dngSize(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const { ifd0, readIfd } = tiffReader(bytes);
    const subs = (ifd0.get(TAG.subIfds) ?? []).flatMap((offset) => {
      try {
        return [readIfd(offset)];
      } catch {
        return [];
      }
    });
    const isMainRaw = (ifd: Ifd) => (first(ifd, TAG.newSubFileType) ?? 0) === 0 && [32803, 34892].includes(first(ifd, TAG.photometric) ?? 0);
    const largest = (ifds: readonly Ifd[]) => ifds.reduce<Ifd | null>((best, ifd) => (pixelCount(ifd) > (best ? pixelCount(best) : 0) ? ifd : best), null);
    const main = largest([ifd0, ...subs].filter(isMainRaw)) ?? largest(subs) ?? ifd0;

    const stored = { width: first(main, TAG.imageWidth) ?? 0, height: first(main, TAG.imageLength) ?? 0 };
    if (stored.width <= 0 || stored.height <= 0) return null;
    const either = (tag: number) => main.get(tag) ?? ifd0.get(tag);
    const active = either(TAG.activeArea);
    if (active && active.length !== 4) return null;
    const [top = 0, left = 0, bottom = 0, right = 0] = active ?? [0, 0, stored.height, stored.width];
    if (!(top < bottom && left < right && bottom <= stored.height && right <= stored.width)) return null;
    let width = right - left;
    let height = bottom - top;

    const pair = (tag: number) => {
      const v = either(tag);
      return v && v.length === 2 && v.every(Number.isFinite) ? v : null;
    };
    const origin = pair(TAG.defaultCropOrigin);
    const size = pair(TAG.defaultCropSize);
    const scale = pair(TAG.defaultScale);
    const isScaleOne = scale === null || (scale[0] === 1 && scale[1] === 1);
    if (origin && size && isScaleOne && [...origin, ...size].every((v) => v >= 0 && Math.abs(v - Math.round(v)) < 1e-6)) {
      const [cx = 0, cy = 0, cw = 0, ch = 0] = [...origin, ...size].map(Math.round);
      if (cw > 0 && ch > 0 && cx + cw <= width && cy + ch <= height) {
        width = cw;
        height = ch;
      }
    }
    const orientation = first(ifd0, TAG.orientation) ?? first(main, TAG.orientation) ?? 1;
    return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}
