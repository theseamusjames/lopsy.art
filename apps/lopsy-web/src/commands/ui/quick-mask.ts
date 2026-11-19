import { defineCommand } from '../registry';
import { toggleQuickMaskMode } from '../../app/interactions/quick-mask-ops';

export const uiQuickMaskToggle = defineCommand({
  id: 'ui.quick-mask.toggle',
  summary:
    'The Q key: enters Quick Mask mode, or leaves it without waiting for the painted mask to become the selection. Agents should use quickmask.set, which says which state it wants and waits for that. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    toggleQuickMaskMode();
  },
});
