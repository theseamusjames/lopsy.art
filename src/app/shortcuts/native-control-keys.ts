/**
 * Arrow keys that native range inputs, radio buttons, and selects use for
 * their own built-in behavior (slider stepping, radio-group navigation,
 * option cycling). When one of those has focus, the global arrow-key nudge
 * shortcut must not fire first and win the race against the control's own
 * handling — #897 (a regression from #817, which let every other shortcut,
 * such as ⌘Z or a tool-select letter key, keep working on a focused
 * non-text input like these).
 */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isRangeOrRadioInput(el: HTMLInputElement): boolean {
  const type = (el.type || 'text').toLowerCase();
  return type === 'range' || type === 'radio';
}

/**
 * True when `target` natively owns this arrow-key press — a range
 * slider's stepping, a radio group's arrow navigation, or a select's
 * option cycling — and the global arrow-key nudge shortcut should stand
 * down so the control's own behavior isn't pre-empted.
 */
export function isNativeArrowKeyTarget(target: EventTarget | null, key: string): boolean {
  if (!ARROW_KEYS.has(key)) return false;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return isRangeOrRadioInput(target);
  return false;
}
