// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportItem, ImportJob, ImportProgress } from '@lopsy/photos-core/import/types';
import { FakeSession } from '../../app/fake/fake-session';
import { useUi } from '../../app/store';
import { useToasts } from '../../app/toasts';
import { ImportStrip } from './ImportStrip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(id: string, state: ImportItem['state'], error: string | null = null): ImportItem {
  return { id, fileName: `${id}.jpg`, byteSize: 1000, state, sentBytes: state === 'queued' ? 0 : 1000, assetId: null, error };
}

/** An import whose progress the test moves on. */
function controlledJob(start: ImportProgress): { job: ImportJob; move: (next: ImportProgress) => void } {
  let progress = start;
  const listeners = new Set<() => void>();
  const job: ImportJob = {
    id: 'import-1',
    getProgress: () => progress,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: () => undefined,
    pause: () => undefined,
    finished: new Promise<ImportProgress>(() => undefined),
  };
  return {
    job,
    move: (next) => {
      progress = next;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

let session: FakeSession;
let root: Root | null = null;
let host: HTMLElement;
const strip = () => host.querySelector('section[aria-label="Import"]');
const politeWords = () => host.querySelector('[role="status"]')?.textContent ?? '';
const toasts = () => useToasts.getState().toasts.map((t) => t.message);

beforeEach(() => {
  session = new FakeSession('memory', 'Test');
  act(() => {
    useUi.getState().setConnection({ session, accountLabel: 'Test' });
    useToasts.setState({ toasts: [] });
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => {
    useUi.getState().setConnection(null);
    useToasts.setState({ toasts: [] });
  });
  await session.close();
});

function startImport(start: ImportProgress): (next: ImportProgress) => void {
  const { job, move } = controlledJob(start);
  act(() => useUi.getState().setImportJob(job));
  act(() => root?.render(<ImportStrip />));
  return move;
}

describe('the import strip', () => {
  it('shows progress, then turns a clean end into a toast and goes', () => {
    const move = startImport({ finished: false, items: [item('a', 'done'), item('b', 'queued')] });
    expect(strip()?.textContent).toContain('Importing 1 of 2 photos');
    expect(politeWords()).toBe('Import started: 2 photos');

    move({ finished: true, items: [item('a', 'done'), item('b', 'done')] });
    expect(toasts()).toEqual(['Imported 2 photos']);
    expect(strip()).toBeNull();
    expect(useUi.getState().importJob).toBeNull();
    // The toast says it; the strip's own live region does not say it again.
    expect(politeWords()).toBe('');
  });

  it('keeps the strip, and makes no toast, when something failed', () => {
    const move = startImport({ finished: false, items: [item('a', 'done'), item('b', 'queued')] });
    move({ finished: true, items: [item('a', 'done'), item('b', 'unsupported', 'Not a supported photo format')] });
    expect(toasts()).toEqual([]);
    expect(strip()?.textContent).toContain('Imported 1 photo');
    expect(strip()?.textContent).toContain('1 photo could not be imported');
    expect(useUi.getState().importJob).not.toBeNull();
    expect(politeWords()).toBe('Import done: 1 photo added');
  });

  it('keeps the strip for photos waiting to try again, and for a pause', () => {
    const waiting = startImport({ finished: false, items: [item('a', 'queued'), item('b', 'queued')] });
    waiting({ finished: true, items: [item('a', 'done'), item('b', 'queued', 'Waiting to retry: offline')] });
    expect(strip()?.textContent).toContain('Retry');

    const paused = startImport({ finished: false, items: [item('c', 'queued'), item('d', 'queued')] });
    paused({ finished: true, items: [item('c', 'done'), item('d', 'queued', 'Paused')] });
    expect(strip()?.textContent).toContain('Resume');
    expect(toasts()).toEqual([]);
  });
});
