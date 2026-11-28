// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterruptedImport as Summary } from '@lopsy/photos-core/import/interrupted';
import { getBackend } from '../../app/backend-registry';
import { FakeSession } from '../../app/fake/fake-session';
import { useUi } from '../../app/store';
import { InterruptedImport } from './InterruptedImport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUMMARY: Summary = {
  total: 700,
  imported: 288,
  missing: Array.from({ length: 412 }, (_, i) => ({ fileName: `DSCF${5288 + i}.RAF`, byteSize: 52_000_000, lastModified: i })),
};

let session: FakeSession;
let root: Root | null = null;
let host: HTMLElement;
const notice = () => host.querySelector('section[aria-label="Interrupted import"]');
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);

beforeEach(() => {
  session = new FakeSession('memory', 'Test');
  act(() => useUi.getState().setConnection({ session, accountLabel: 'Test' }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => useUi.getState().setConnection(null));
  await session.close();
  vi.restoreAllMocks();
});

describe('the interrupted import', () => {
  it('is one line for the job, says it once, lists the files and is dismissed', () => {
    act(() => root?.render(<InterruptedImport />));
    expect(notice()).toBeNull();
    act(() => useUi.getState().setInterruptedImport(SUMMARY));
    expect(notice()?.textContent).toContain('An import was interrupted: 288 of 700 photos imported, 412 not');
    expect(notice()?.textContent).toContain('Choose the same photos or folder again');
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Import interrupted: 412 photos not imported. Choose the same photos again to finish.');
    // A count that changes is not said again.
    act(() => useUi.getState().setInterruptedImport({ ...SUMMARY, imported: 300, missing: SUMMARY.missing.slice(12) }));
    expect(status?.textContent).toBe('Import interrupted: 412 photos not imported. Choose the same photos again to finish.');

    act(() => button('List the 400 photos not imported')?.click());
    expect(host.querySelectorAll('ul[aria-label="Photos not imported"] li')).toHaveLength(400);
    expect(button('Download the list')).toBeDefined();
    expect(button('Copy the list')).toBeDefined();

    const dismiss = vi.spyOn(getBackend(), 'dismissInterruptedImport');
    act(() => button('Dismiss the interrupted import')?.click());
    expect(dismiss).toHaveBeenCalledWith(session);
    expect(notice()).toBeNull();
  });
});
