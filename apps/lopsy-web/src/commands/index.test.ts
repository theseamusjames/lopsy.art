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
