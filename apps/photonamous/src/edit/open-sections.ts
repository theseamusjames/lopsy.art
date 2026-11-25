import { useCallback, useState } from 'react';

/**
 * Which of the Edit panel's sections is open, kept on this device so it is
 * as the user left it. One is open at a time, as a group's effects are in
 * Lopsy: opening a section folds the one that was open. What is stored is
 * a list, which the app writes with one id or none; a stored list of
 * several (the browser tests start with every section open) shows them
 * all until one is opened.
 */
const KEY = 'photonamous.edit-sections';

export function loadOpenSections(storage: Pick<Storage, 'getItem'> | null = safeStorage()): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveOpenSections(open: ReadonlySet<string>, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify([...open]));
  } catch {
    // Storage is full or off: the sections are still open for this visit.
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** `open` after the heading of `id` is pressed: an open section folds; a folded one opens and the others fold. */
export function toggled(open: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!open.has(id)) return new Set([id]);
  const next = new Set(open);
  next.delete(id);
  return next;
}

/** The open section, and a toggle for one. Every section starts folded. */
export function useOpenSections(): { readonly isOpen: (id: string) => boolean; readonly toggle: (id: string) => void } {
  const [open, setOpen] = useState(() => loadOpenSections());
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = toggled(prev, id);
      saveOpenSections(next);
      return next;
    });
  }, []);
  return { isOpen: (id) => open.has(id), toggle };
}
