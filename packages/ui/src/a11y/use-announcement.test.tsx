// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncement } from './use-announcement';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function Region({ message }: { message: string | null }) {
  return <p role="status">{useAnnouncement(message, 1500)}</p>;
}

function show(message: string | null): void {
  act(() => root?.render(<Region message={message} />));
}

const said = () => host.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useAnnouncement', () => {
  it('says nothing about the state it starts in', () => {
    show('Everything is saved');
    act(() => vi.advanceTimersByTime(5000));
    expect(said()).toBe('');
  });

  it('says a change once it has settled, then clears it', () => {
    show('Everything is saved');
    show('Offline — changes are kept');
    act(() => vi.advanceTimersByTime(1400));
    expect(said()).toBe('');
    act(() => vi.advanceTimersByTime(200));
    expect(said()).toBe('Offline — changes are kept');
    act(() => vi.advanceTimersByTime(5000));
    expect(said()).toBe('');
  });

  it('never says a state that came and went, nor what is waiting', () => {
    show('Everything is saved');
    show(null);
    show('Saving…');
    act(() => vi.advanceTimersByTime(500));
    show('Everything is saved');
    act(() => vi.advanceTimersByTime(5000));
    expect(said()).toBe('');

    show('Saving…');
    act(() => vi.advanceTimersByTime(1600));
    expect(said()).toBe('Saving…');
    show('Everything is saved');
    act(() => vi.advanceTimersByTime(1600));
    expect(said()).toBe('Everything is saved');
  });
});
