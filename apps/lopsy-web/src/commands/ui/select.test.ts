import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invertSelectionAction: vi.fn(() => false) }));

vi.mock('../../app/selection-actions', () => ({ invertSelectionAction: mocks.invertSelectionAction }));

const { runCommand } = await import('../registry');
await import('./select');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ui.select.inverse', () => {
  it('calls invertSelectionAction in the synchronous part, and is not refused when nothing was selected', async () => {
    const pending = runCommand('ui.select.inverse');
    expect(mocks.invertSelectionAction).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toBeUndefined();
  });
});
