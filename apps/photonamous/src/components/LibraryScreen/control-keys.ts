/**
 * Keys a focused control answers itself, which the library's shortcuts
 * must leave to it: Enter and Space press buttons, links, checkboxes,
 * radios, menu items and tabs; the arrows, Home, End, Page Up and Page Down
 * move sliders and step through radio groups, menus, tabs and lists.
 * Photo tiles are grid cells, not controls: their keys stay shortcuts.
 */

const PRESSED_BY_ENTER_OR_SPACE = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
]);

const MOVED_BY_ARROWS = new Set([
  'slider',
  'spinbutton',
  'scrollbar',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
]);

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const INPUT_ROLES: Readonly<Record<string, string>> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  button: 'button',
  submit: 'button',
  reset: 'button',
  file: 'button',
  color: 'button',
  image: 'button',
};

export interface ControlKeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  switch (el.tagName) {
    case 'BUTTON':
    case 'SUMMARY':
      return 'button';
    case 'A':
      return el.hasAttribute('href') ? 'link' : '';
    case 'INPUT':
      return INPUT_ROLES[(el as HTMLInputElement).type] ?? '';
    default:
      return '';
  }
}

/** Whether the focused control does something with this key, so a shortcut must not take it. */
export function isControlKey(input: ControlKeyInput, target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (input.ctrlKey || input.metaKey || input.altKey) return false;
  const role = roleOf(target);
  if (role === '') return false;
  if (input.key === 'Enter' || input.key === ' ') return PRESSED_BY_ENTER_OR_SPACE.has(role);
  if (ARROW_KEYS.has(input.key)) return MOVED_BY_ARROWS.has(role);
  return false;
}
