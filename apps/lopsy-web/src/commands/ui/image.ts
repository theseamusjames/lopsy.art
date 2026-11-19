import { defineCommand } from '../registry';
import { openMenuDialog } from './dialogs';
import { useEditorStore } from '../../app/editor-store';
import type { DocumentColorMode } from '../../types';

/** Image > Mode's items, in the menu's order. */
const MODES = ['rgb', 'grayscale', 'indexed', 'cmyk', 'lab'] as const satisfies readonly DocumentColorMode[];

export const uiImageMode = defineCommand({
  id: 'ui.image.mode',
  summary:
    'An Image > Mode item exactly as the menu runs it: indexed opens the Indexed Color dialog; any other mode converts ("Convert to <Mode>"), queued behind any conversion still running, and does nothing when the document is in that mode by then. Checked for the document\'s mode. Agents should use doc.color-mode, which reports the result. Returns nothing, once the conversion has run.',
  surface: 'ui',
  params: { mode: { type: 'string', enum: MODES } },
  checked({ mode }): boolean {
    return useEditorStore.getState().document.colorMode === mode;
  },
  run({ mode }): void | Promise<void> {
    if (mode === 'indexed') return openMenuDialog('image', 'convert-to-indexed');
    return useEditorStore.getState().convertColorMode(mode);
  },
});
