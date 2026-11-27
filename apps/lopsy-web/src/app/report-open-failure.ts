/**
 * Where every way of opening or adding an image reports a failure. A file
 * too large for this device (io/image-too-large.ts: the typed error, or the
 * engine's refusal of the texture) is shown once, as the message centred
 * over the canvas that says why; any other failure is the toast it always
 * was.
 */
import { tooLargeFrom, tooLargeMessage, type TooLargeKind } from '../io/image-too-large';
import { useCanvasMessageStore } from './canvas-message-store';
import { useEditorStore } from './editor-store';
import { notifyError } from './notifications-store';

/** What was being opened: the noun the message uses, and the file's name when there is one. */
export interface OpenAttempt {
  readonly kind: TooLargeKind;
  readonly name: string | null;
}

/** Whether `err` was about size; if so, the message over the canvas is showing. */
export function showIfTooLarge(err: unknown, attempt: OpenAttempt): boolean {
  const tooLarge = tooLargeFrom(err);
  if (!tooLarge) return false;
  const text = tooLargeMessage({ ...attempt, width: tooLarge.width, height: tooLarge.height }, tooLarge.limit);
  useCanvasMessageStore.getState().show({ ...text, documentVersion: useEditorStore.getState().documentVersion });
  return true;
}

/** A failed open: the message over the canvas when it was about size, else the toast `toast` (as before). */
export function reportOpenFailure(err: unknown, attempt: OpenAttempt, toast: string): void {
  if (!showIfTooLarge(err, attempt)) notifyError(toast);
}
