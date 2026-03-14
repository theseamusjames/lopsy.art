import type { MenuDef } from './types';

export type HelpDialogId = 'keyboard-shortcuts' | 'about';

export function createHelpMenu(showDialog: (id: HelpDialogId) => void): MenuDef {
  return {
    label: 'Help',
    items: [
      { label: 'Keyboard Shortcuts', action: () => showDialog('keyboard-shortcuts') },
      { label: 'About Lopsy', action: () => showDialog('about') },
    ],
  };
}
