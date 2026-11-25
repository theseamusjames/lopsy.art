import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: { document: { colorMode: 'rgb' } },
}));

vi.mock('../../app/editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));

const { getCommand, runCommand } = await import('../registry');
const { registerDialogOpener, unregisterDialogOpener } = await import('../../app/MenuBar/dialog-openers');
const { CommandError } = await import('../command');
await import('./image');

beforeEach(() => {
  mocks.editor.document.colorMode = 'rgb';
});

afterEach(() => {
  unregisterDialogOpener('image');
});

describe('ui.image.indexed-color', () => {
  it('opens the Indexed Color dialog in the synchronous part', async () => {
    const opener = vi.fn();
    registerDialogOpener('image', opener);
    const pending = runCommand('ui.image.indexed-color');
    expect(opener.mock.calls).toEqual([['convert-to-indexed']]);
    await expect(pending).resolves.toBeUndefined();
  });

  it('is unavailable without the menu bar', async () => {
    await expect(runCommand('ui.image.indexed-color')).rejects.toBeInstanceOf(CommandError);
  });

  it('is checked while the document is Indexed', () => {
    const command = getCommand('ui.image.indexed-color')!;
    expect(command.checked?.({})).toBe(false);
    mocks.editor.document.colorMode = 'indexed';
    expect(command.checked?.({})).toBe(true);
  });
});
