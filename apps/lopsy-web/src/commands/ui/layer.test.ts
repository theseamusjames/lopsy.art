import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: { duplicateLayer: vi.fn() },
  openAdjustmentLayer: vi.fn(),
}));

vi.mock('../../app/editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));
vi.mock('../../app/MenuBar/layer-menu-actions', () => ({ openAdjustmentLayer: mocks.openAdjustmentLayer }));

const { runCommand } = await import('../registry');
await import('./layer');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ui.layer.* commands', () => {
  it.each([
    ['ui.layer.duplicate', () => mocks.editor.duplicateLayer],
    ['ui.layer.adjustment-layer', () => mocks.openAdjustmentLayer],
  ] as const)('%s makes its one call in the synchronous part, with no pre-check', async (id, wrapped) => {
    const pending = runCommand(id);
    expect(wrapped()).toHaveBeenCalledTimes(1);
    expect(wrapped()).toHaveBeenCalledWith();
    await expect(pending).resolves.toBeUndefined();
  });
});
