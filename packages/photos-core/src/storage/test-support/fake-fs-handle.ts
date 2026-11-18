/**
 * An in-memory File System Access handle tree for Node tests: enough of
 * FileSystemDirectoryHandle and FileSystemFileHandle for the local-folder
 * adapter, with the browser's error names (NotFoundError,
 * TypeMismatchError, InvalidModificationError).
 */

type WriteData = Blob | string | ArrayBuffer | ArrayBufferView;

function notFound(name: string): DOMException {
  return new DOMException(`${name} was not found`, 'NotFoundError');
}

let pendingWriteFailures = 0;

/** Makes the next `count` writes to any fake file fail as if the disk were full. */
export function failNextWrites(count = 1): void {
  pendingWriteFailures = count;
}

export class FakeWritable {
  private readonly parts: Blob[] = [];
  private done = false;

  constructor(private readonly target: FakeFileHandle) {}

  async write(data: WriteData): Promise<void> {
    if (this.done) throw new TypeError('The stream is closed');
    if (pendingWriteFailures > 0) {
      pendingWriteFailures -= 1;
      throw new DOMException('The disk is full', 'QuotaExceededError');
    }
    if (data instanceof Blob) this.parts.push(data);
    else if (typeof data === 'string') this.parts.push(new Blob([data]));
    else if (data instanceof ArrayBuffer) this.parts.push(new Blob([data.slice(0)]));
    else this.parts.push(new Blob([new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()]));
  }

  async close(): Promise<void> {
    if (this.done) throw new TypeError('The stream is closed');
    this.done = true;
    this.target.commit(new Blob(this.parts));
  }

  async abort(): Promise<void> {
    this.done = true;
  }
}

export class FakeFileHandle {
  readonly kind = 'file' as const;
  private data: Blob = new Blob([]);
  private lastModified = Date.now();

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    return new File([this.data], this.name, { lastModified: this.lastModified });
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this);
  }

  /** Called by FakeWritable.close: like the browser, content changes only when the stream closes. */
  commit(data: Blob): void {
    this.data = data;
    this.lastModified = Date.now();
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly children = new Map<string, FakeDirectoryHandle | FakeFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectoryHandle) return existing;
    if (existing) throw new DOMException(`${name} is a file`, 'TypeMismatchError');
    if (!options.create) throw notFound(name);
    const created = new FakeDirectoryHandle(name);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeFileHandle) return existing;
    if (existing) throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
    if (!options.create) throw notFound(name);
    const created = new FakeFileHandle(name);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw notFound(name);
    if (existing instanceof FakeDirectoryHandle && existing.children.size > 0 && !options.recursive) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FakeDirectoryHandle | FakeFileHandle]> {
    for (const entry of [...this.children]) yield entry;
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const key of [...this.children.keys()]) yield key;
  }

  async *values(): AsyncIterableIterator<FakeDirectoryHandle | FakeFileHandle> {
    for (const value of [...this.children.values()]) yield value;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FakeDirectoryHandle | FakeFileHandle]> {
    return this.entries();
  }
}

/** Every path below `dir`, folders ending in '/', sorted. */
export async function listPaths(dir: FakeDirectoryHandle, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle instanceof FakeDirectoryHandle) {
      paths.push(`${prefix}${name}/`);
      paths.push(...(await listPaths(handle, `${prefix}${name}/`)));
    } else {
      paths.push(`${prefix}${name}`);
    }
  }
  return paths.sort();
}

/** The text of the file at a '/'-separated path, or null when there is none. */
export async function readPath(dir: FakeDirectoryHandle, path: string): Promise<string | null> {
  const parts = path.split('/');
  const fileName = parts.pop() ?? '';
  try {
    let current = dir;
    for (const part of parts) current = await current.getDirectoryHandle(part);
    return await (await (await current.getFileHandle(fileName)).getFile()).text();
  } catch {
    return null;
  }
}
