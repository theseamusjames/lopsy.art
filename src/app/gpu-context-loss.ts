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

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Lost-context warning when a CPU backup of the layers exists (#973). */
export function contextLostWithBackupMessage(takenAt: number): string {
  return 'The graphics context was lost (the browser reset the GPU). Your layers will be '
    + `restored from the backup taken at ${formatTime(takenAt)} once graphics come back.`;
}

/** Restored-context notice after the backup was re-uploaded (#973). */
export function contextRestoredFromBackupMessage(takenAt: number): string {
  return `Graphics restored. Layers were recovered from the backup taken at ${formatTime(takenAt)}, `
    + 'when you last left the tab; changes made after that are lost. Undo has been cleared.';
}

/**
 * Tell the user as soon as the context goes: every GPU texture is gone
 * (#973). `backupTakenAt` is the time of the CPU backup, if there is one.
 */
export function handleGpuContextLost(backupTakenAt: number | null = null): void {
  notifyError(backupTakenAt === null ? CONTEXT_LOST_MESSAGE : contextLostWithBackupMessage(backupTakenAt));
}

/**
 * Called once a fresh engine exists on the restored context. Every undo/redo
 * snapshot is a GPU texture handle from the lost context: undoing to one
 * threw "Invalid snapshot handle" and changed nothing, so the history is
 * cleared rather than left pointing at textures that no longer exist (#973).
 * `restoredFromBackupAt` is the backup's time when layers were recovered.
 */
export function handleGpuContextRestored(restoredFromBackupAt: number | null = null): void {
  forgetLostGpuSnapshotCache();
  useEditorStore.setState((s) => ({
    undoStack: [],
    redoStack: [],
    dirtyLayerIds: new Set(),
    renderVersion: s.renderVersion + 1,
  }));
  notifyError(restoredFromBackupAt === null
    ? CONTEXT_RESTORED_MESSAGE
    : contextRestoredFromBackupMessage(restoredFromBackupAt));
}
