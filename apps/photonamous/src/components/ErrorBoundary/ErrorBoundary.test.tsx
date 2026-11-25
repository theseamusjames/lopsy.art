// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { FakeSession } from '../../app/fake/fake-session';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Broken(): never {
  throw new Error('No library is open');
}

function SessionLabel() {
  return <span>{useSession().adapter.label}</span>;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows Something went wrong with Reload instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = document.createElement('div');
    document.body.append(host);
    act(() => createRoot(host).render(<ErrorBoundary><Broken /></ErrorBoundary>));
    expect(host.textContent).toContain('Something went wrong');
    expect(host.querySelector('button')?.textContent).toBe('Reload');
  });
});

describe('useSession while the library closes', () => {
  it('keeps the library that was open for a last render instead of throwing', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const session = new FakeSession('browser', 'This browser');
    act(() => useUi.getState().setConnection({ session, accountLabel: 'This browser' }));
    const root = createRoot(host);
    act(() => root.render(<ErrorBoundary><SessionLabel /></ErrorBoundary>));
    expect(host.textContent).toBe('This browser');
    act(() => useUi.getState().setConnection(null));
    expect(host.textContent).toBe('This browser');
    act(() => root.unmount());
  });
});
