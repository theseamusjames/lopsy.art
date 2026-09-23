/**
 * Detection + typed access to the tinyjs desktop bridge (`window.tiny`),
 * which the tinyjs launcher injects into the page before it boots. In the
 * browser build `window.tiny` is undefined and every caller falls back to
 * web behaviour.
 */

export type TinyStockRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'standard';

export interface TinyMenuItemSpec {
  /** A stock editing item the launcher builds (tinyjs 0.41+). */
  role?: TinyStockRole;
  id?: string;
  label?: string;
  key?: string;
  checked?: boolean;
  enabled?: boolean;
  submenu?: TinyMenuItemSpec[];
  separator?: boolean;
}

export interface TinyMenuSpec {
  title?: string;
  items?: TinyMenuItemSpec[];
  role?: 'edit' | 'app';
}

export interface TinyMenuApi {
  set(menus: TinyMenuSpec[]): Promise<unknown>;
  on(fn: (id: string) => void): () => void;
}

export interface TinyHost {
  menu: TinyMenuApi;
}

function isTinyHost(value: unknown): value is TinyHost {
  if (typeof value !== 'object' || value === null) return false;
  const menu = (value as { menu?: unknown }).menu;
  if (typeof menu !== 'object' || menu === null) return false;
  const m = menu as { set?: unknown; on?: unknown };
  return typeof m.set === 'function' && typeof m.on === 'function';
}

export function getTinyHost(): TinyHost | null {
  if (typeof window === 'undefined') return null;
  const tiny: unknown = (window as { tiny?: unknown }).tiny;
  return isTinyHost(tiny) ? tiny : null;
}
