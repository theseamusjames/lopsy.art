// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pauseToasts, resumeToasts, showErrorToast, showToast, useToasts } from '../../app/toasts';
import { Toasts } from './Toasts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Toasts />));
  return host;
}

const messages = () => useToasts.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.useFakeTimers();
  act(() => useToasts.setState({ toasts: [] }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  resumeToasts();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('toast timers', () => {
  it('go after their time, but not while held', () => {
    act(() => {
      showToast('Imported 2 photos', 6000);
    });
    act(() => vi.advanceTimersByTime(4000));
    pauseToasts();
    act(() => vi.advanceTimersByTime(60_000));
    expect(messages()).toEqual(['Imported 2 photos']);
    resumeToasts();
    act(() => vi.advanceTimersByTime(1900));
    expect(messages()).toEqual(['Imported 2 photos']);
    act(() => vi.advanceTimersByTime(200));
    expect(messages()).toEqual([]);
  });

  it('start a toast that arrives while held only once it is let go', () => {
    pauseToasts();
    act(() => {
      showToast('Photo set aside.', 6000, { label: 'Undo', run: () => undefined });
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(messages()).toEqual(['Photo set aside.']);
    resumeToasts();
    act(() => vi.advanceTimersByTime(6000));
    expect(messages()).toEqual([]);
  });
});

describe('Toasts', () => {
  it('announces errors as alerts and the rest politely, in regions that are always there', () => {
    const host = mount();
    const alert = host.querySelector('[role="alert"]');
    const status = host.querySelector('[role="status"]');
    expect(alert).not.toBeNull();
    expect(status).not.toBeNull();
    act(() => {
      showErrorToast('Adding from Google Drive failed: offline');
      showToast('Imported 2 photos');
    });
    expect(alert?.textContent).toContain('Adding from Google Drive failed: offline');
    expect(status?.textContent).toContain('Imported 2 photos');
    expect(status?.textContent).not.toContain('failed');
  });

  it('holds the toasts while focus is in one, and its action dismisses it, giving focus back', () => {
    const host = mount();
    const before = document.createElement('button');
    document.body.prepend(before);
    before.focus();
    const run = vi.fn();
    act(() => {
      showToast('Photo set aside.', 6000, { label: 'Undo', run });
    });
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
    act(() => undo?.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(messages()).toEqual(['Photo set aside.']);

    act(() => undo?.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);
    expect(document.activeElement).toBe(before);
  });

  it('dismisses the focused toast on Escape, moving focus to the next one, and keeps the key from the page', () => {
    const host = mount();
    const pageKeys = vi.fn();
    window.addEventListener('keydown', pageKeys);
    act(() => {
      showToast('First', null);
      showToast('Second', null);
    });
    const dismissButtons = host.querySelectorAll<HTMLElement>('[aria-label="Dismiss"]');
    act(() => dismissButtons[0]?.focus());
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(messages()).toEqual(['Second']);
    expect(document.activeElement?.closest('[data-toast-id]')?.textContent).toContain('Second');
    expect(pageKeys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageKeys);
  });
});
