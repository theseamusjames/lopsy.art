import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError } from '../command';
import { runCommand } from '../registry';
import { registerDialogOpener, unregisterDialogOpener, type DialogFamily } from '../../app/MenuBar/dialog-openers';
import './dialogs';

const FAMILIES: DialogFamily[] = ['filter', 'image', 'help', 'select', 'export'];

afterEach(() => {
  for (const family of FAMILIES) unregisterDialogOpener(family);
});

async function failure(promise: Promise<unknown>): Promise<CommandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as CommandError;
  }
  throw new Error('expected a rejection');
}

describe('ui.dialog.* commands', () => {
  it.each([
    ['ui.dialog.filter', 'filter', { dialog: 'gaussian-blur' }, 'gaussian-blur'],
    ['ui.dialog.filter', 'filter', { dialog: 'pattern-fill' }, 'pattern-fill'],
    ['ui.dialog.filter', 'filter', { dialog: 'color-lut' }, 'color-lut'],
    ['ui.dialog.image', 'image', { dialog: 'convert-to-indexed' }, 'convert-to-indexed'],
    ['ui.dialog.select', 'select', { dialog: 'feather' }, 'feather'],
    ['ui.dialog.help', 'help', { dialog: 'about' }, 'about'],
    ['ui.dialog.export', 'export', {}, 'export'],
  ] as const)('%s calls the %s opener with %j in the synchronous part', async (id, family, params, opened) => {
    const opener = vi.fn();
    registerDialogOpener(family, opener);
    const pending = runCommand(id, params);
    expect(opener.mock.calls).toEqual([[opened]]);
    await expect(pending).resolves.toBeUndefined();
  });

  it('opens only its own family', async () => {
    const image = vi.fn();
    const help = vi.fn();
    registerDialogOpener('image', image);
    registerDialogOpener('help', help);
    await runCommand('ui.dialog.help', { dialog: 'keyboard-shortcuts' });
    expect(image).not.toHaveBeenCalled();
    expect(help).toHaveBeenCalledWith('keyboard-shortcuts');
  });

  it('is unavailable, silently, on a page without the menu bar', async () => {
    const error = await failure(runCommand('ui.dialog.filter', { dialog: 'bloom' }));
    expect(error.code).toBe('unavailable');
    expect(error.notice).toBeNull();
    expect(error.message).toMatch(/menu bar is not on this page/);
  });

  it('is unavailable again once the opener is unregistered', async () => {
    registerDialogOpener('select', vi.fn());
    unregisterDialogOpener('select');
    expect((await failure(runCommand('ui.dialog.select', { dialog: 'grow' }))).code).toBe('unavailable');
  });

  it('rejects a dialog id the family does not have', async () => {
    registerDialogOpener('image', vi.fn());
    expect((await failure(runCommand('ui.dialog.image', { dialog: 'about' }))).code).toBe('invalid');
  });
});
