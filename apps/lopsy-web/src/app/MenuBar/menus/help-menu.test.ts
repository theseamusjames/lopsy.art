// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '../../../commands/ui/dialogs';
import '../../../commands/ui/help';
import { invokeFromUi } from '../../../commands/invoke-from-ui';
import { registerDialogOpener, unregisterDialogOpener } from '../dialog-openers';
import { AGENTS_URL, createHelpMenu } from './help-menu';

describe('Help menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    unregisterDialogOpener('help');
  });

  it('lists Keyboard Shortcuts, Agents, then About Lopsy', () => {
    const labels = createHelpMenu().items.filter((i) => !i.separator).map((i) => i.label);
    expect(labels).toEqual(['Keyboard Shortcuts', 'Agents', 'About Lopsy']);
  });

  it('Agents opens llms.txt in a new tab without opening a dialog', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const showDialog = vi.fn();
    registerDialogOpener('help', showDialog);
    const agents = createHelpMenu().items.find((i) => i.label === 'Agents');

    invokeFromUi(agents!.command!.id, agents!.command!.params);

    expect(AGENTS_URL).toBe('/llms.txt');
    expect(open).toHaveBeenCalledWith('/llms.txt', '_blank', 'noopener');
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('Keyboard Shortcuts and About Lopsy open their dialogs', () => {
    const showDialog = vi.fn();
    registerDialogOpener('help', showDialog);
    const items = createHelpMenu().items;

    for (const label of ['Keyboard Shortcuts', 'About Lopsy']) {
      const item = items.find((i) => i.label === label)!;
      invokeFromUi(item.command!.id, item.command!.params);
    }

    expect(showDialog.mock.calls).toEqual([['keyboard-shortcuts'], ['about']]);
  });
});
