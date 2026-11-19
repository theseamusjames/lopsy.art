import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: { selection: { active: false } },
  defineBrush: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../app/editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));
vi.mock('../../app/MenuBar/brush-actions', () => ({ defineBrush: mocks.defineBrush }));

const { getCommand, runCommand } = await import('../registry');
await import('./edit');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editor.selection.active = false;
});

describe('ui.edit.* commands', () => {
  it('ui.edit.define-brush passes color through and waits for the prompt flow', async () => {
    const pending = runCommand('ui.edit.define-brush', { color: true });
    expect(mocks.defineBrush.mock.calls).toEqual([[true]]);
    await pending;
    await runCommand('ui.edit.define-brush');
    expect(mocks.defineBrush.mock.calls[1]).toEqual([false]);
  });

  it('ui.edit.define-brush is enabled exactly when a selection is active', () => {
    const command = getCommand('ui.edit.define-brush')!;
    expect(command.enabled?.({ color: false })).toBe(false);
    mocks.editor.selection.active = true;
    expect(command.enabled?.({ color: true })).toBe(true);
  });
});
