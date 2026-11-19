import { defineCommand } from '../registry';
import { invertSelectionAction } from '../../app/selection-actions';

export const uiSelectInverse = defineCommand({
  id: 'ui.select.inverse',
  summary:
    'Select > Inverse exactly as the menu runs it: a pending Move-tool float is committed, then the selection is inverted ("Inverse Selection"); with nothing selected only the float is committed. Agents should use select.invert, which refuses when nothing is selected. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    invertSelectionAction();
  },
});
