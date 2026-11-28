import { describe, expect, it, vi } from 'vitest';
import { notifyAll } from '../listeners';
import { shownMessage, UNEXPECTED_ERROR_TEXT } from '../shown-message';
import { StorageError } from '../storage/errors';
import { startImport } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { PreviewRenderer } from './types';

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob([`p${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

/** What React throws from a store listener once its nested-update limit is passed. */
const REACT_185 = new Error('Minified React error #185; visit https://react.dev/errors/185 for the full message');

describe('listeners are not the import', () => {
  it('a subscriber that throws fails no file, and the job finishes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = new TestMemoryAdapter();
    const root = await adapter.getRoot();
    const originals = await adapter.createFolder(root.id, 'Originals');
    const previews = await adapter.createFolder(root.id, 'previews');
    const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
    // The library's own listeners throw too, as a React subscriber does.
    session.subscribe(() => {
      throw REACT_185;
    });
    const files = Array.from({ length: 12 }, (_, i) => new File([buildJpeg({ width: 300 + i, height: 200 })], `F${i}.JPG`));
    const job = startImport(files, { session, previewRenderer: renderer, queueStore: new MemoryImportQueueStore(), staging: new MemoryStagingStore() });
    let calls = 0;
    job.subscribe(() => {
      calls++;
      throw REACT_185;
    });
    const result = await job.finished;
    expect(calls).toBeGreaterThan(12);
    expect(result.items.map((i) => [i.state, i.error])).toEqual(files.map(() => ['done', null]));
    expect(session.getView().assets.size).toBe(12);
    vi.restoreAllMocks();
  });

  it('notifyAll tells every listener even when one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard: number[] = [];
    notifyAll(
      [
        () => heard.push(1),
        () => {
          throw new Error('boom');
        },
        () => heard.push(3),
      ],
      'a test',
    );
    expect(heard).toEqual([1, 3]);
    vi.restoreAllMocks();
  });

  it("shows the app's own sentences and hides internal ones", () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(shownMessage(new StorageError('quota-exceeded', 'The storage is full'), 'Import')).toBe('The storage is full');
    expect(shownMessage(REACT_185, 'Import')).toBe(UNEXPECTED_ERROR_TEXT);
    expect(shownMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), 'Import')).toBe(UNEXPECTED_ERROR_TEXT);
    expect(shownMessage('a string', 'Import')).toBe(UNEXPECTED_ERROR_TEXT);
    // The raw text is kept for the console.
    expect(log).toHaveBeenCalledWith('Import: unexpected error', REACT_185);
    vi.restoreAllMocks();
  });
});
