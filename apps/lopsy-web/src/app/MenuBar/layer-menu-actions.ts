import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';

/**
 * Layer > Adjustment Layer…: adjustments live on groups, so it activates the
 * root group, opens the effects drawer and explains. It switches layer with
 * setActiveLayer directly, so a pending Move float or layer transform is not
 * committed as a row click commits it, and mask edit mode is kept.
 */
export function openAdjustmentLayer(): void {
  const rootGroupId = useEditorStore.getState().document.rootGroupId;
  if (rootGroupId) useEditorStore.getState().setActiveLayer(rootGroupId);
  useUIStore.getState().setShowEffectsDrawer(true);
  useUIStore.getState().openModal({ kind: 'adjustmentLayerInfo' });
}
