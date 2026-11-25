import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearPersistentTransform } from './gesture-session';

/**
 * What Cmd+D and Escape do, unlike Select > Deselect: besides dropping the
 * selection, the transform box goes and a pending Move float or multi-layer
 * transform is committed.
 */
export function deselectAndCommit(): void {
  useEditorStore.getState().clearSelection();
  useUIStore.getState().setTransform(null);
  clearPersistentTransform();
}
