/**
 * An image, project or paste larger than Lopsy can hold. Every layer is one
 * texture, so a document side is capped at `getDocumentSizeLimit()`: the
 * GPU's largest texture, or Lopsy's own `MAX_DOCUMENT_SIDE` when the GPU
 * allows more. Each way in checks the size as soon as it is known, before
 * any document or canvas is made, and throws `ImageTooLargeError`; the
 * engine's own refusal of a texture (`tooLargeFrom`) is recognised too, for
 * a route that learns the size only from the engine. The UI shows it as a
 * message over the canvas (app/report-open-failure.ts), and the command API
 * rejects with the same words.
 */

import type { DocumentSizeLimit } from '../utils/document-size';

/** What was refused: an image opened or dropped (a PSD and a RAW too), a `.lopsy` project, or a paste. */
export type TooLargeKind = 'image' | 'project' | 'paste';

export interface TooLargeSubject {
  readonly kind: TooLargeKind;
  /** The file's name as the person knows it; null when there is none (a paste from the clipboard). */
  readonly name: string | null;
  readonly width: number;
  readonly height: number;
}

export interface TooLargeText {
  readonly title: string;
  readonly body: string;
}

const pixels = new Intl.NumberFormat('en-US');

/** The message's words: what is too large, how large it is, why that is too large here, and what to do. */
export function tooLargeMessage(subject: TooLargeSubject, limit: DocumentSizeLimit): TooLargeText {
  const noun = subject.kind === 'project' ? 'project' : 'image';
  const title = subject.kind === 'paste' ? 'This image is too large to paste' : `This ${noun} is too large to open`;
  const who = subject.name ?? (subject.kind === 'paste' ? 'The pasted image' : `The ${noun}`);
  const size = `${who} is ${pixels.format(subject.width)} × ${pixels.format(subject.height)} pixels.`;
  const side = `${pixels.format(limit.side)} pixels on a side`;
  const why = limit.isDevice
    ? `Lopsy keeps each layer as one image in this device's graphics memory, and the largest this device allows is ${side}.`
    : `Lopsy keeps each layer as one image, and the largest it allows is ${side}.`;
  return { title, body: `${size} ${why} ${nextStep(subject.kind, limit)}` };
}

function nextStep(kind: TooLargeKind, limit: DocumentSizeLimit): string {
  if (kind === 'paste') return 'Make the image smaller and paste it again.';
  if (kind === 'image') return 'Make the image smaller and open it again.';
  return limit.isDevice ? 'Open it on a device whose graphics allow larger images.' : 'Lopsy cannot open a project this large.';
}

/** An image, project or paste larger than `limit` on a side. Its message is the reason without a file name. */
export class ImageTooLargeError extends Error {
  readonly width: number;
  readonly height: number;
  readonly limit: DocumentSizeLimit;

  constructor(width: number, height: number, limit: DocumentSizeLimit, kind: TooLargeKind = 'image') {
    super(tooLargeMessage({ kind, name: null, width, height }, limit).body);
    this.name = 'ImageTooLargeError';
    this.width = width;
    this.height = height;
    this.limit = limit;
  }
}

/** Throws `ImageTooLargeError` when a `width` × `height` image would not fit a document here. */
export function assertFitsDocument(width: number, height: number, limit: DocumentSizeLimit, kind: TooLargeKind = 'image'): void {
  if (width > limit.side || height > limit.side) throw new ImageTooLargeError(width, height, limit, kind);
}

/**
 * The engine's refusal of a texture larger than the GPU allows, as both
 * builds word it (`engine/src/gpu/{wgpu,webgl}/texture_pool.rs`):
 * `texture {w}x{h} exceeds the GPU limit of {n}`.
 */
const ENGINE_LIMIT = /texture (\d+)x(\d+) exceeds the GPU limit of (\d+)/;

/** The size and limit of a failure that was about size: an `ImageTooLargeError`, or the engine's refusal; null for any other failure. */
export function tooLargeFrom(err: unknown): { width: number; height: number; limit: DocumentSizeLimit } | null {
  if (err instanceof ImageTooLargeError) return { width: err.width, height: err.height, limit: err.limit };
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const match = ENGINE_LIMIT.exec(text);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]), limit: { side: Number(match[3]), isDevice: true } };
}
