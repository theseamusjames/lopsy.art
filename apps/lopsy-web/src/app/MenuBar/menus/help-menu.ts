import { commandItem } from './command-item';
import type { MenuDef } from './types';

export type HelpDialogId = 'keyboard-shortcuts' | 'about';

export const AGENTS_URL = '/llms.txt';

export function createHelpMenu(): MenuDef {
  return {
    label: 'Help',
    items: [
      commandItem('Keyboard Shortcuts', 'ui.dialog.help', { dialog: 'keyboard-shortcuts' }),
      // A new tab so an open document isn't lost by navigating away.
      commandItem('Agents', 'ui.help.agents'),
      { separator: true, label: '' },
      commandItem('About Lopsy', 'ui.dialog.help', { dialog: 'about' }),
    ],
  };
}
