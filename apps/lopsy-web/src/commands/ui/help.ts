import { defineCommand } from '../registry';
import { AGENTS_URL } from '../../app/MenuBar/menus/help-menu';

export const uiHelpAgents = defineCommand({
  id: 'ui.help.agents',
  summary: 'Opens the guide for agents (/llms.txt) in a new tab, so an open document is not lost, as Help > Agents does. It needs a user gesture. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    window.open(AGENTS_URL, '_blank', 'noopener');
  },
});
