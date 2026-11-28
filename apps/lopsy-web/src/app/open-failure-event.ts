/**
 * The `file_error` event for a failed open, paste or handoff
 * (packages/tracking/README.md). Built apart from the message the person
 * is shown, which names the file: only fixed sentences and the engine's
 * refusal sentences go in the reason, and the format is from the fixed
 * list. Pure.
 */

import {
  engineReason,
  formatFromName,
  sideExceeded,
  type FileError,
  type FileFormat,
} from '@lopsy/tracking/file-error';
import { tooLargeFrom, type TooLargeKind } from '../io/image-too-large';

/** What the event says was being opened. */
export interface FailureSubject {
  readonly kind: TooLargeKind;
  /** The file's name, when there is one: read for its extension, and to keep it out of an engine sentence. Never sent. */
  readonly name: string | null;
  /** The file's format when its name does not say it (a paste's MIME type). */
  readonly format?: FileFormat;
  /** The photo came from Photonamous' handoff. */
  readonly isHandoff?: boolean;
}

/** The image formats Lopsy opens through the browser's decoder (`OPEN_FILE_ACCEPT`). */
const IMAGE_FORMATS: ReadonlySet<FileFormat> = new Set(['jpeg', 'png', 'gif', 'bmp', 'webp']);

const NOUNS: Readonly<Record<TooLargeKind, string>> = { image: 'Image', project: 'Project', paste: 'Pasted image' };

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

/** A `ProjectFormatError` (io/project-format.ts), told by its name so this module does not load the project code. */
function projectReason(err: unknown): string {
  if (!(err instanceof Error) || err.name !== 'ProjectFormatError') return 'Project could not be loaded';
  if (err.message.startsWith('Not a valid .lopsy file')) return 'Not a Lopsy project';
  if (err.message.includes('newer version of Lopsy')) return 'Project saved by a newer version of Lopsy';
  return 'Project file is damaged';
}

/** The event for `err`, the failure of opening `subject`. */
export function openFailureEvent(err: unknown, subject: FailureSubject): FileError {
  const format = subject.format ?? (subject.name ? formatFromName(subject.name) : 'other');
  const tooLarge = tooLargeFrom(err);
  if (tooLarge) {
    const limit = tooLarge.limit.side;
    return { kind: 'too-large', reason: sideExceeded(NOUNS[subject.kind], tooLarge.width, limit), format, limit };
  }
  if (subject.isHandoff) return { kind: 'decode-failed', reason: 'Photo from Photonamous could not be received', format };
  if (subject.kind === 'project' || format === 'lopsy') return { kind: 'decode-failed', reason: projectReason(err), format };
  if (format === 'dng' || format === 'raf') {
    return { kind: 'raw-refused', reason: engineReason(messageOf(err), 'RAW file could not be decoded', subject.name), format };
  }
  if (format === 'psd') return { kind: 'decode-failed', reason: engineReason(messageOf(err), 'PSD could not be read', subject.name), format };
  if (IMAGE_FORMATS.has(format)) {
    return { kind: 'decode-failed', reason: subject.kind === 'paste' ? 'Pasted image could not be decoded' : 'Image could not be decoded', format };
  }
  return { kind: 'unsupported-type', reason: 'File type not supported', format };
}
