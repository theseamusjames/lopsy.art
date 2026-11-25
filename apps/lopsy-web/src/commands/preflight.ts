import { CommandError } from './command';
import { gpuContextPreflight } from './context';
import { useUIStore } from '../app/ui-store';
import { isLivePreviewShowing } from '../app/live-preview';

export const LIVE_PREVIEW_MESSAGE =
  'The person has a dialog open with a live preview on the layer. Nothing was run. Send the call again once they apply or cancel it.';

export const CANVAS_DRAG_MESSAGE =
  'A drag or scroll on the canvas is in progress. Nothing was run. Send the call again once it is released.';

/**
 * Refuses while the person is in the middle of something a call would
 * break. Under a dialog's live preview an edit is lost on Cancel while
 * History keeps its step, and baked into the preview on Apply. During a
 * press on the canvas (the interacting flag: a stroke, a drag, a pan or a
 * scroll), a gesture command ends the person's stroke and other commands
 * split it across history. Every command is refused, reads included: a read
 * would report the preview or the half-made stroke as the document.
 *
 * The gesture commands set the same flag for their own press and clear it
 * on release before they resolve, so a batch's next step is not refused;
 * only a second call sent while a held or paced gesture is still in flight
 * meets it.
 */
export function personActivityPreflight(): void {
  if (isLivePreviewShowing()) throw new CommandError('unavailable', LIVE_PREVIEW_MESSAGE);
  if (useUIStore.getState().isInteracting) throw new CommandError('unavailable', CANVAS_DRAG_MESSAGE);
}

/**
 * The API's preflight (registry setPreflight), checked before each call and
 * each step of a batch on the API path only: a lost graphics context first,
 * then what the person is doing. The UI's path (start, invokeFromUi) never
 * consults it, so nothing a person does is refused by it.
 */
export function apiPreflight(): void {
  gpuContextPreflight();
  personActivityPreflight();
}
