/**
 * Gathers files from a drop (files and whole folders) or a file input.
 * Folders are walked with `webkitGetAsEntry`, which every current browser
 * supports for drops.
 */

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries returns at most ~100 entries per call; keep reading until empty.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await entryFile(entry as FileSystemFileEntry));
    return;
  }
  if (entry.isDirectory) {
    // Skip hidden folders such as .Trashes on memory cards.
    if (entry.name.startsWith('.')) return;
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walk(child, out);
  }
}

/** Every file in a drop, with folders walked. Hidden files are left out. */
export async function filesFromDataTransfer(data: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  const out: File[] = [...loose];
  for (const entry of entries) await walk(entry, out);
  return out.filter((f) => !f.name.startsWith('.'));
}

/** Whether a drag carries files (not text or a link). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return data !== null && Array.from(data.types).includes('Files');
}

/** Whether this browser can pick a whole folder with a file input. */
export function canPickFolder(): boolean {
  return typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
}
