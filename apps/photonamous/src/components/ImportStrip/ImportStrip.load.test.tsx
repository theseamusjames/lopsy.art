// @vitest-environment jsdom
/**
 * A large import notifies its listeners once per change of a file, from
 * the import's own async work, often many times before the browser runs
 * another task. Each notification renders the strip (useSyncExternalStore
 * renders at the sync lane, and React flushes the passive effects of a
 * sync render inside its commit). If anything the strip does in those
 * effects schedules a render, every such commit ends with work pending,
 * React counts it as a nested update, and the 51st in a row throws
 * "Maximum update depth exceeded" (error 185 in production) from the
 * import's own listener call, where it became a file's error.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportItem, ImportJob, ImportProgress } from '@lopsy/photos-core/import/types';
import { FakeSession } from '../../app/fake/fake-session';
import { useUi } from '../../app/store';
import { useToasts } from '../../app/toasts';
import { ImportStrip } from './ImportStrip';

const FILES = 300;

function item(i: number, state: ImportItem['state']): ImportItem {
  return { id: `f${i}`, fileName: `f${i}.jpg`, byteSize: 1000, state, sentBytes: state === 'queued' ? 0 : 1000, assetId: null, error: null };
}

/** An import that notifies the way the importer does: synchronously, each listener in its own try/catch. */
function fastJob(): { job: ImportJob; settle: (i: number) => void; errors: unknown[] } {
  const items = Array.from({ length: FILES }, (_, i) => item(i, 'queued'));
  let progress: ImportProgress = { items, finished: false };
  const listeners = new Set<() => void>();
  const errors: unknown[] = [];
  const job: ImportJob = {
    id: 'import-load',
    getProgress: () => progress,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: () => undefined,
    pause: () => undefined,
    finished: new Promise<ImportProgress>(() => undefined),
  };
  const settle = (i: number) => {
    const next = progress.items.slice();
    next[i] = item(i, 'done');
    progress = { items: next, finished: false };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
  };
  return { job, settle, errors };
}

/** Lets queued microtasks (React's sync flush among them) run, but no task: the scheduler's work waits. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let session: FakeSession;
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => {
    useUi.getState().setImportJob(null);
    useUi.getState().setConnection(null);
    useToasts.setState({ toasts: [] });
  });
  await session.close();
});

describe('the import strip under a fast import', () => {
  it('takes hundreds of notifications in a row without a nested-update error', async () => {
    const { job, settle, errors } = fastJob();
    act(() => useUi.getState().setImportJob(job));
    act(() => root?.render(<ImportStrip />));
    // Outside act, as in the browser: React flushes sync work in a microtask and other work in a task.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    for (let i = 0; i < FILES - 1; i++) {
      settle(i);
      await microtasks();
    }
    expect(errors.map((e) => (e instanceof Error ? e.message : String(e)))).toEqual([]);
    expect(host.querySelector('section[aria-label="Import"]')?.textContent).toContain(`Importing ${FILES - 1} of ${FILES} photos`);
    // A screen reader still hears each quarter, worked out as the strip renders.
    expect(host.querySelector('[role="status"]')?.textContent).toBe(`Import 75 % done: ${FILES * 0.75} of ${FILES} photos`);
  });
});
