// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../registry';
import './help';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ui.help.agents', () => {
  it('opens /llms.txt in a new tab in the synchronous part, where a popup is still allowed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const pending = runCommand('ui.help.agents');
    expect(open.mock.calls).toEqual([['/llms.txt', '_blank', 'noopener']]);
    await expect(pending).resolves.toBeUndefined();
  });
});
