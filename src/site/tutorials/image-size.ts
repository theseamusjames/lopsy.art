import type { ImageSize } from './types';

export const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function imageMimeType(file: string): string | null {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return null;
  return MIME_TYPES[file.slice(dot).toLowerCase()] ?? null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readPng(view: DataView): ImageSize {
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readGif(view: DataView): ImageSize {
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readJpeg(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but don't.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function readWebp(bytes: Uint8Array, view: DataView): ImageSize | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    const width = 1 + (view.getUint32(24, true) & 0xffffff);
    const height = 1 + (view.getUint32(27, true) & 0xffffff);
    return { width, height };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return null;
}

/** Reads pixel dimensions from an image file header. Returns null for unknown or truncated files. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return readPng(view);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes, view);
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return readWebp(bytes, view);
    if (ascii(bytes, 0, 3) === 'GIF') return readGif(view);
  } catch {
    return null;
  }
  return null;
}
