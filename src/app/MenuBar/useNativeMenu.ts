import { useEffect, useRef } from 'react';
import { getTinyHost } from '../desktop/tiny-host';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { buildNativeMenu } from './native-menu';
import type { MenuDef } from './menus/types';

// Menu builders read disabled/checked state straight from the stores, and
// the native bar has no "about to open" hook to rebuild on — so rebuild on
// store changes instead, coalesced so a brush stroke's burst of editor
// updates costs one rebuild rather than one per event.
const REBUILD_DELAY_MS = 150;

function isTextEditable(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']
    .includes(el.type);
}

/**
 * In the tinyjs desktop build, mirror the menu definitions into the native
 * app menu and route clicks back to their actions. Returns whether the
 * native menu is active (the caller hides the in-page bar when it is).
 */
export function useNativeMenu(buildMenus: () => MenuDef[]): boolean {
  const host = getTinyHost();
  const buildRef = useRef(buildMenus);
  buildRef.current = buildMenus;

  useEffect(() => {
    if (!host) return;
    let actions = new Map<string, () => void>();
    let lastSpecJson = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sync = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const isTextFocused = isTextEditable(document.activeElement);
      const built = buildNativeMenu(buildRef.current(), { isTextFocused });
      actions = built.actions;
      const specJson = JSON.stringify(built.spec);
      if (specJson === lastSpecJson) return;
      lastSpecJson = specJson;
      void host.menu.set(built.spec);
    };
    const scheduleSync = () => {
      if (timer === null) timer = setTimeout(sync, REBUILD_DELAY_MS);
    };

    sync();
    const offClick = host.menu.on((id) => actions.get(id)?.());
    const offEditor = useEditorStore.subscribe(scheduleSync);
    const offUI = useUIStore.subscribe(scheduleSync);
    // Focus decides stock vs Lopsy clipboard items — swap at once, before
    // the first ⌘C in (or out of) a text field.
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      offClick();
      offEditor();
      offUI();
    };
  }, [host]);

  return host !== null;
}
