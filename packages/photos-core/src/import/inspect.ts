import { readMetadata } from './exif';
import { extractPreview } from './preview';
import type { InspectedImage } from './types';

/**
 * Metadata and embedded preview of a file; null when its format is not
 * supported. `source` is the file itself, reused as the preview of a JPEG,
 * PNG or WebP instead of copying `bytes`.
 */
export function inspectImage(bytes: Uint8Array, source?: Blob): InspectedImage | null {
  const metadata = readMetadata(bytes);
  if (!metadata) return null;
  return { metadata, preview: extractPreview(bytes, metadata.format, metadata.orientation, source) };
}
