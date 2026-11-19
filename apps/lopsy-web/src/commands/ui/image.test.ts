import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: {
    document: { colorMode: 'rgb' },
    convertColorMode: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../app/editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));

const { getCommand, runCommand } = await import('../registry');
const { registerDialogOpener, unregisterDialogOpener } = await import('../../app/MenuBar/dialog-openers');
await import('./image');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editor.document.colorMode = 'rgb';
});

afterEach(() => {
  unregisterDialogOpener('image');
});

describe('ui.image.mode', () => {
  it('converts in the synchronous part, even to the current mode, leaving that check to the queued conversion', async () => {
    const pending = runCommand('ui.image.mode', { mode: 'grayscale' });
    expect(mocks.editor.convertColorMode.mock.calls).toEqual([['grayscale']]);
    await pending;
    await runCommand('ui.image.mode', { mode: 'rgb' });
    expect(mocks.editor.convertColorMode.mock.calls[1]).toEqual(['rgb']);
  });

  it('opens the Indexed Color dialog for indexed instead of converting', async () => {
    const opener = vi.fn();
    registerDialogOpener('image', opener);
    await runCommand('ui.image.mode', { mode: 'indexed' });
    expect(opener.mock.calls).toEqual([['convert-to-indexed']]);
    expect(mocks.editor.convertColorMode).not.toHaveBeenCalled();
  });

  it('is checked for the document\'s mode only', () => {
    const command = getCommand('ui.image.mode')!;
    mocks.editor.document.colorMode = 'lab';
    const checked = ['rgb', 'grayscale', 'indexed', 'cmyk', 'lab'].map((mode) => command.checked?.({ mode }));
    expect(checked).toEqual([false, false, false, false, true]);
  });
});
