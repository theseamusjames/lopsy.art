/**
 * Whether a dialog's live preview is on a layer: a filter, Color LUT or
 * Pattern Fill dialog with Preview checked, whose original pixels the engine
 * holds (saveFilterPreview) until the person applies or cancels. Set by the
 * dialogs' begin functions once the original is saved, and cleared as their
 * apply or cancel starts, so a failed apply cannot leave it set. The command
 * API refuses while it is set: an edit made under a preview is lost on
 * Cancel and baked into the preview on Apply.
 */
let isShowing = false;

export function setLivePreviewShowing(showing: boolean): void {
  isShowing = showing;
}

export function isLivePreviewShowing(): boolean {
  return isShowing;
}
