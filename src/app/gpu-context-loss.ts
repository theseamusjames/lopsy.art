import { useEditorStore } from './editor-store';
import { notifyError } from './notifications-store';
import { forgetLostGpuSnapshotCache } from './store/history-slice';

export const CONTEXT_LOST_MESSAGE =
  'The graphics context was lost (the browser reset the GPU). Layer pixels live on the GPU, '
  + 'so anything painted so far may be gone even if the canvas comes back. '
  + 'Reopen your last saved project rather than continuing to work on this one.';

export const CONTEXT_RESTORED_MESSAGE =
  'Graphics restored, but layer pixels and the undo history from before the reset could not be '
  + 'recovered. Undo has been cleared.';

/** Tell the user as soon as the context goes: every GPU texture is gone (#973). */
export function handleGpuContextLost(): void {
  notifyError(CONTEXT_LOST_MESSAGE);
}

/**
 * Called once a fresh engine exists on the restored context. Every undo/redo
 * snapshot is a GPU texture handle from the lost context: undoing to one
 * threw "Invalid snapshot handle" and changed nothing, so the history is
 * cleared rather than left pointing at textures that no longer exist (#973).
 */
export function handleGpuContextRestored(): void {
  forgetLostGpuSnapshotCache();
  useEditorStore.setState((s) => ({
    undoStack: [],
    redoStack: [],
    dirtyLayerIds: new Set(),
    renderVersion: s.renderVersion + 1,
  }));
  notifyError(CONTEXT_RESTORED_MESSAGE);
}
