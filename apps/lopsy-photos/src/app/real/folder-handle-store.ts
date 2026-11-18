/**
 * Keeps the folder the user picked (a FileSystemDirectoryHandle) in
 * IndexedDB, so the next visit can offer "Reopen <folder>". Handles are
 * structured-cloneable in Chromium; permission must be asked again, from a
 * click, each visit.
 */

const DB_NAME = 'lopsy-photos-folders';
const STORE = 'handles';
const KEY = 'last';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await run('readwrite', (store) => store.put(handle, KEY));
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const value: unknown = await run('readonly', (store) => store.get(KEY));
    return value instanceof FileSystemDirectoryHandle ? value : null;
  } catch {
    return null;
  }
}

export async function forgetFolderHandle(): Promise<void> {
  await run('readwrite', (store) => store.delete(KEY)).catch(() => undefined);
}

type PermissionMethod = (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;

/** Asks for read/write access again; must run inside a click. True when granted. */
export async function ensureReadWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const query: unknown = Reflect.get(handle, 'queryPermission');
  const request: unknown = Reflect.get(handle, 'requestPermission');
  if (typeof query === 'function' && (await (query as PermissionMethod).call(handle, { mode: 'readwrite' })) === 'granted') {
    return true;
  }
  if (typeof request !== 'function') return true;
  return (await (request as PermissionMethod).call(handle, { mode: 'readwrite' })) === 'granted';
}

/** Opens the system folder picker; null when the user cancels. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker: unknown = Reflect.get(window, 'showDirectoryPicker');
  if (typeof picker !== 'function') throw new Error('This browser cannot open a folder on the computer.');
  try {
    const handle: unknown = await (picker as (o: { mode: 'readwrite' }) => Promise<unknown>).call(window, { mode: 'readwrite' });
    return handle instanceof FileSystemDirectoryHandle ? handle : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
