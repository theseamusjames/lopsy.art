import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { enterQuickMaskMode, exitQuickMaskMode } from '../../app/interactions/quick-mask-ops';

export interface QuickMaskResult {
  enabled: boolean;
  selection: {
    active: boolean;
    /** In document pixels; null when nothing is selected. */
    bounds: { x: number; y: number; width: number; height: number } | null;
  };
}

function quickMaskState(): QuickMaskResult {
  const { selection } = useEditorStore.getState();
  return {
    enabled: useUIStore.getState().maskMode === 'quickMask',
    selection: {
      active: selection.active,
      bounds: selection.active && selection.bounds ? { ...selection.bounds } : null,
    },
  };
}

export const quickMaskSet = defineCommand({
  id: 'quickmask.set',
  summary:
    'Enters or leaves Quick Mask mode, as the Q key and the toolbox toggle do (no history step); nothing happens when it is already in that state. Entering drops the selection and paints it as the mask overlay; painting then edits the mask. Leaving turns the painted mask into the selection, and the command waits for that. Returns whether Quick Mask is on and the resulting selection.',
  surface: 'document',
  params: { enabled: { type: 'boolean', description: 'true enters Quick Mask, false leaves it.' } },
  async run({ enabled }): Promise<QuickMaskResult> {
    requireDocument();
    const isOn = useUIStore.getState().maskMode === 'quickMask';
    if (enabled && !isOn) enterQuickMaskMode();
    if (!enabled && isOn) await exitQuickMaskMode();
    return quickMaskState();
  },
});
