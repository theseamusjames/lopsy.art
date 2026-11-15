// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AGENTS_URL, createHelpMenu } from './help-menu';

describe('Help menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists Keyboard Shortcuts, Agents, then About Lopsy', () => {
    const labels = createHelpMenu(() => {}).items.filter((i) => !i.separator).map((i) => i.label);
    expect(labels).toEqual(['Keyboard Shortcuts', 'Agents', 'About Lopsy']);
  });

  it('Agents opens llms.txt in a new tab without opening a dialog', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const showDialog = vi.fn();
    const agents = createHelpMenu(showDialog).items.find((i) => i.label === 'Agents');

    agents!.action!();

    expect(AGENTS_URL).toBe('/llms.txt');
    expect(open).toHaveBeenCalledWith('/llms.txt', '_blank', 'noopener');
    expect(showDialog).not.toHaveBeenCalled();
  });
});
