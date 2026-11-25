/**
 * The tabs pattern for the Edit view's tabbed groups (WCAG 4.1.2, 2.1.1):
 * one tab stop for the tab list, arrow keys, Home and End between tabs,
 * each tab naming the panel it controls.
 */

import { useId, useRef, type KeyboardEvent } from 'react';

/** The tab a key moves to from tab `index` of `count`, or null for other keys. Arrows wrap. */
export function nextTabIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export interface TabProps {
  readonly id: string;
  readonly role: 'tab';
  readonly 'aria-selected': boolean;
  readonly 'aria-controls': string;
  readonly tabIndex: number;
  readonly ref: (element: HTMLButtonElement | null) => void;
  readonly onClick: () => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface TabPanelProps {
  readonly id: string;
  readonly role: 'tabpanel';
  readonly 'aria-labelledby': string;
}

/** Props for a tab list's tabs and its one panel, which shows the selected tab. */
export function useTabs<T extends string>(
  ids: readonly T[],
  selected: T,
  onSelect: (id: T) => void,
): { tabProps: (id: T) => TabProps; panelProps: TabPanelProps } {
  const base = useId();
  const tabs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  const tabProps = (id: T): TabProps => ({
    id: tabId(id),
    role: 'tab',
    'aria-selected': id === selected,
    'aria-controls': panelId,
    tabIndex: id === selected ? 0 : -1,
    ref: (element) => {
      if (element) tabs.current.set(id, element);
      else tabs.current.delete(id);
    },
    onClick: () => onSelect(id),
    onKeyDown: (e) => {
      const next = nextTabIndex(ids.indexOf(id), e.key, ids.length);
      const nextId = next === null ? undefined : ids[next];
      if (nextId === undefined) return;
      e.preventDefault();
      onSelect(nextId);
      tabs.current.get(nextId)?.focus();
    },
  });

  return { tabProps, panelProps: { id: panelId, role: 'tabpanel', 'aria-labelledby': tabId(selected) } };
}
