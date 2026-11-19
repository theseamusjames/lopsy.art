import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: { undo: vi.fn(), redo: vi.fn(), selection: { active: false } },
  ui: { clearGuides: vi.fn() },
  fillSelection: vi.fn(),
  defineBrush: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../app/editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));
vi.mock('../../app/ui-store', () => ({ useUIStore: { getState: () => mocks.ui } }));
vi.mock('../../app/fill-selection', () => ({ fillSelection: mocks.fillSelection }));
vi.mock('../../app/MenuBar/brush-actions', () => ({ defineBrush: mocks.defineBrush }));

const { getCommand, runCommand } = await import('../registry');
await import('./edit');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editor.selection.active = false;
});

describe('ui.edit.* commands', () => {
  it.each([
    ['ui.edit.undo', () => mocks.editor.undo],
    ['ui.edit.redo', () => mocks.editor.redo],
    ['ui.edit.fill', () => mocks.fillSelection],
    ['ui.edit.clear-guides', () => mocks.ui.clearGuides],
  ] as const)('%s makes its one call in the synchronous part, with no pre-check', async (id, wrapped) => {
    const pending = runCommand(id);
    expect(wrapped()).toHaveBeenCalledTimes(1);
    expect(wrapped()).toHaveBeenCalledWith();
    await expect(pending).resolves.toBeUndefined();
  });

  it('ui.edit.undo and ui.edit.redo run even with nothing to undo, as the menu does', async () => {
    await runCommand('ui.edit.undo');
    await runCommand('ui.edit.redo');
    expect(mocks.editor.undo).toHaveBeenCalledTimes(1);
    expect(mocks.editor.redo).toHaveBeenCalledTimes(1);
  });

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
