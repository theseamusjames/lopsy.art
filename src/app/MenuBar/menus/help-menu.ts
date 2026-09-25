import type { MenuDef } from './types';

export type HelpDialogId = 'keyboard-shortcuts' | 'about';

export const TUTORIALS_URL = '/tutorials/';

export function createHelpMenu(showDialog: (id: HelpDialogId) => void): MenuDef {
  return {
    label: 'Help',
    items: [
      // A new tab so an open document isn't lost by navigating away.
      { label: 'Tutorials', action: () => window.open(TUTORIALS_URL, '_blank', 'noopener') },
      { separator: true, label: '' },
      { label: 'Keyboard Shortcuts', action: () => showDialog('keyboard-shortcuts') },
      { label: 'About Lopsy', action: () => showDialog('about') },
    ],
  };
}
