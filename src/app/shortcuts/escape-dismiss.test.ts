import { describe, it, expect, vi, afterEach } from 'vitest';
import { dismissTopPopover, registerEscapeDismiss } from './escape-dismiss';

describe('escape-dismiss', () => {
  const unregisters: Array<() => void> = [];
  afterEach(() => {
    unregisters.splice(0).forEach((u) => u());
  });

  it('reports false with nothing open', () => {
    expect(dismissTopPopover()).toBe(false);
  });

  it('closes the most recently opened popover first', () => {
    const first = vi.fn();
    const second = vi.fn();
    unregisters.push(registerEscapeDismiss(first), registerEscapeDismiss(second));

    expect(dismissTopPopover()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    expect(dismissTopPopover()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(dismissTopPopover()).toBe(false);
  });

  it('skips a popover that closed on its own', () => {
    const dismiss = vi.fn();
    const unregister = registerEscapeDismiss(dismiss);
    unregister();
    expect(dismissTopPopover()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
