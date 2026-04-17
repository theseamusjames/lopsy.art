import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'panel:';
const STORAGE_SUFFIX = ':collapsed';

/** Internal: storage key for a given panel id. Exported for tests. */
export function panelCollapseKey(id: string): string {
  return `${STORAGE_PREFIX}${id}${STORAGE_SUFFIX}`;
}

/** Internal: read persisted collapse state, falling back when storage fails. */
export function readPanelCollapse(id: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(panelCollapseKey(id));
    if (raw == null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

/** Internal: persist collapse state, swallowing storage failures. */
export function writePanelCollapse(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(panelCollapseKey(id), collapsed ? '1' : '0');
  } catch {
    // localStorage may be disabled (private mode, quota); fall back to memory.
  }
}

/**
 * Per-panel collapse state with localStorage persistence.
 *
 * Each panel owns its own collapse — App.tsx doesn't track this. Adding a
 * new panel doesn't require any change in App; the panel just calls this
 * hook with a stable id.
 */
export function usePanelCollapse(
  id: string,
  defaultCollapsed = false,
): readonly [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [collapsed, setCollapsed] = useState(() => readPanelCollapse(id, defaultCollapsed));

  useEffect(() => {
    writePanelCollapse(id, collapsed);
  }, [id, collapsed]);

  const toggle = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setCollapsed((prev) => (typeof next === 'function' ? next(prev) : next));
    },
    [],
  );

  return [collapsed, toggle] as const;
}
