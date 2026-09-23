import type { MenuDef, MenuItem } from './menus/types';
import type { TinyMenuItemSpec, TinyMenuSpec } from '../desktop/tiny-host';

export interface NativeMenu {
  spec: TinyMenuSpec[];
  actions: Map<string, () => void>;
}

const MODIFIER_GLYPHS: Record<string, string> = {
  '⌥': 'alt',
  '⇧': 'shift',
  '⌃': 'ctrl',
};

/**
 * Convert a display shortcut ('⇧⌘Z', '⌥⇧⌘E', '⌘=') to a tinyjs menu key
 * ('Z', 'alt+E', '='). tinyjs menu keys always include ⌘, so a
 * shortcut without ⌘ (e.g. '⇧F5') can't be a menu accelerator and returns
 * null — the page's own keydown handler still owns it.
 */
export function shortcutToTinyKey(shortcut: string): string | null {
  const chars = Array.from(shortcut);
  if (!chars.includes('⌘')) return null;
  const modifiers: string[] = [];
  let key = '';
  for (const ch of chars) {
    if (ch === '⌘') continue;
    const mod = MODIFIER_GLYPHS[ch];
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    key += ch;
  }
  if (key.length !== 1) return null;
  // AppKit reads shift out of an uppercase letter; a 'shift+' prefix on a
  // letter doesn't reliably bind (seen in tinyjs-examples/nib), so only
  // non-letters carry it spelled out.
  const isLetter = /^[a-z]$/i.test(key);
  const shiftAsCase = isLetter && modifiers.includes('shift');
  const ordered = ['ctrl', 'alt', 'shift']
    .filter((m) => modifiers.includes(m))
    .filter((m) => !(shiftAsCase && m === 'shift'));
  const finalKey = shiftAsCase ? key.toUpperCase() : key.toLowerCase();
  return [...ordered, finalKey].join('+');
}

export interface NativeMenuContext {
  /** An input, textarea or contenteditable has focus. */
  isTextFocused: boolean;
}

// Paste stays the stock item even on the canvas: its native paste: command
// is what fires the DOM 'paste' event Lopsy reads files and images from
// (see handlePaste in useKeyboardShortcuts), which an app item would skip.
function usesStockItem(item: MenuItem, ctx: NativeMenuContext): boolean {
  if (!item.nativeRole) return false;
  return item.nativeRole === 'paste' || ctx.isTextFocused;
}

function convertItems(
  items: MenuItem[],
  path: string,
  actions: Map<string, () => void>,
  ctx: NativeMenuContext,
): TinyMenuItemSpec[] {
  return items.map((item, i) => {
    if (item.separator) return { separator: true };
    if (item.nativeRole && usesStockItem(item, ctx)) return { role: item.nativeRole };
    const id = `${path}.${i}`;
    const spec: TinyMenuItemSpec = { id, label: item.label };
    if (item.disabled) spec.enabled = false;
    if (item.checked !== undefined) spec.checked = item.checked;
    if (item.submenu) {
      spec.submenu = convertItems(item.submenu, id, actions, ctx);
      return spec;
    }
    const key = item.shortcut ? shortcutToTinyKey(item.shortcut) : null;
    if (key) spec.key = key;
    if (item.action) actions.set(id, item.action);
    return spec;
  });
}

/**
 * Mirror the in-page menu definitions as a native app menu. Item ids are
 * positional ('m2.4.1') so a click maps straight back to the action closure
 * from the same build.
 *
 * Lopsy's Edit menu becomes tinyjs's `role: 'edit'` block rather than a
 * second menu titled Edit (macOS always has one). Because its items carry
 * stock roles, the launcher adds no stock items of its own — and every
 * ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A stays claimed by some item, which keeps the page
 * seeing those keys first (tinyjs swallows unclaimed ones before the
 * webview does).
 */
export function buildNativeMenu(menus: MenuDef[], ctx: NativeMenuContext): NativeMenu {
  const actions = new Map<string, () => void>();
  const spec: TinyMenuSpec[] = menus.map((menu, i) => {
    const items = convertItems(menu.items, `m${i}`, actions, ctx);
    return menu.label === 'Edit' ? { role: 'edit', items } : { title: menu.label, items };
  });
  return { spec, actions };
}
