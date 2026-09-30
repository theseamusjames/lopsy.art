import type { MenuDef } from './types';

export type HelpDialogId = 'keyboard-shortcuts' | 'about';

export const AGENTS_URL = '/llms.txt';

export function createHelpMenu(showDialog: (id: HelpDialogId) => void): MenuDef {
  return {
    label: 'Help',
    items: [
      { label: 'Keyboard Shortcuts', action: () => showDialog('keyboard-shortcuts') },
      // A new tab so an open document isn't lost by navigating away.
      { label: 'Agents', action: () => window.open(AGENTS_URL, '_blank', 'noopener') },
      { separator: true, label: '' },
      { label: 'About Lopsy', action: () => showDialog('about') },
    ],
  };
}
