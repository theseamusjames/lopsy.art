import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settled: vi.fn(() => Promise.resolve()),
}));

vi.mock('./settled', () => ({ settled: mocks.settled }));

// The first test cold-imports the whole command registry (every family and
// what it reaches), which can take longer than vitest's 5 s default while the
// rest of the suite runs in parallel.
const COLD_IMPORT_TIMEOUT_MS = 30_000;

describe('commands entry point', () => {
  it('installs settled as the default registry settle', { timeout: COLD_IMPORT_TIMEOUT_MS }, async () => {
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

  it('does not settle the commands that only touch tool settings, colours or guides', async () => {
    const { getCommand } = await import('./index');
    const ids = [
      'color.set', 'color.swap', 'color.reset',
      'tool.select', 'tool.options', 'tool.describe', 'tool.set',
      'guide.list', 'guide.add', 'guide.remove', 'guide.clear',
    ];
    expect(ids.filter((id) => getCommand(id)?.settles !== false)).toEqual([]);
  });

  it('leaves color.swap settled at once with no document open, instead of waiting for a render loop', async () => {
    const { runCommand } = await import('./index');
    mocks.settled.mockClear();
    await expect(runCommand('color.swap')).resolves.toMatchObject({ foreground: expect.any(String) });
    expect(mocks.settled).not.toHaveBeenCalled();
  });
});
