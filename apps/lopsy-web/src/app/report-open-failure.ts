/**
 * Where every way of opening or adding an image reports a failure. A file
 * too large for this device (io/image-too-large.ts: the typed error, or the
 * engine's refusal of the texture) is shown once, as the message centred
 * over the canvas that says why; any other failure is the toast it always
 * was. Each failure shown is also reported, once, as a `file_error` event
 * (open-failure-event.ts), which names neither the file nor anything in it.
 */
import { tooLargeFrom, tooLargeMessage } from '../io/image-too-large';
import { useCanvasMessageStore } from './canvas-message-store';
import { useEditorStore } from './editor-store';
import { notifyError } from './notifications-store';
import { openFailureEvent, type FailureSubject } from './open-failure-event';
import { track } from './track';

/**
 * What was being opened: the noun the message uses, and the file's name
 * when there is one (shown, never tracked); for the event, the format when
 * the name does not say it, and whether it came from Photonamous.
 */
export type OpenAttempt = FailureSubject;

/** Whether `err` was about size; if so, the message over the canvas is showing. */
export function showIfTooLarge(err: unknown, attempt: OpenAttempt): boolean {
  const tooLarge = tooLargeFrom(err);
  if (!tooLarge) return false;
  const text = tooLargeMessage({ kind: attempt.kind, name: attempt.name, width: tooLarge.width, height: tooLarge.height }, tooLarge.limit);
  useCanvasMessageStore.getState().show({ ...text, documentVersion: useEditorStore.getState().documentVersion });
  track.error(openFailureEvent(err, attempt));
  return true;
}

/** A failed open that is not about size: the toast `toast`, and its event. */
export function toastOpenFailure(err: unknown, attempt: OpenAttempt, toast: string): void {
  notifyError(toast);
  track.error(openFailureEvent(err, attempt));
}

/** A failed open: the message over the canvas when it was about size, else the toast `toast` (as before). */
export function reportOpenFailure(err: unknown, attempt: OpenAttempt, toast: string): void {
  if (!showIfTooLarge(err, attempt)) toastOpenFailure(err, attempt, toast);
}
