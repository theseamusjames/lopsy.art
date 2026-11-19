import { defineCommand } from '../registry';
import { openMenuDialog } from './dialogs';
import { useEditorStore } from '../../app/editor-store';

export const uiImageIndexedColor = defineCommand({
  id: 'ui.image.indexed-color',
  summary:
    'Image > Mode > Indexed Color...: opens the Indexed Color dialog, closing the open menu; nothing converts until its Apply. Checked while the document is Indexed. Agents should use doc.color-mode with mode indexed, which takes the dialog\'s options. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: {},
  checked(): boolean {
    return useEditorStore.getState().document.colorMode === 'indexed';
  },
  run(): void {
    openMenuDialog('image', 'convert-to-indexed');
  },
});
