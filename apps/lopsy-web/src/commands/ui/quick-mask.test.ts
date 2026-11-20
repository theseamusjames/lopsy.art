import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toggleQuickMaskMode: vi.fn() }));

vi.mock('../../app/interactions/quick-mask-ops', () => ({ toggleQuickMaskMode: mocks.toggleQuickMaskMode }));

const { runCommand } = await import('../registry');
await import('./quick-mask');

describe('ui.quick-mask.toggle', () => {
  it('toggles Quick Mask in the synchronous part, as the Q key does', async () => {
    const pending = runCommand('ui.quick-mask.toggle');
    expect(mocks.toggleQuickMaskMode).toHaveBeenCalledTimes(1);
    expect(mocks.toggleQuickMaskMode).toHaveBeenCalledWith();
    await expect(pending).resolves.toBeUndefined();
  });
});
