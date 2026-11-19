import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settled: vi.fn(() => Promise.resolve()),
}));

vi.mock('./settled', () => ({ settled: mocks.settled }));

describe('commands entry point', () => {
  it('installs settled as the default registry settle', async () => {
    const { defineCommand } = await import('./registry');
    const { runCommand } = await import('./index');
    defineCommand({
      id: 'test.entry-settle',
      summary: 'Test command.',
      surface: 'ui',
      params: {},
      run: () => 'done',
    });
    await expect(runCommand('test.entry-settle')).resolves.toBe('done');
    expect(mocks.settled).toHaveBeenCalledTimes(1);
  });
});
