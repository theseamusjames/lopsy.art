/** Tab order inside a dialog, and handing focus back when it closes. */

const CANDIDATES = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function isRendered(el: HTMLElement): boolean {
  // jsdom has no layout and no checkVisibility; everything there counts as shown.
  return typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : true;
}

function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]') !== null) return false;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
  return isRendered(el);
}

function radioGroup(radio: HTMLInputElement, root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (r) => r.name === radio.name && r.form === radio.form && isTabbable(r),
  );
}

/** The radio Tab stops on: the checked one in its group, else the group's first. */
function radioStop(radio: HTMLInputElement, root: HTMLElement): HTMLInputElement {
  if (radio.name === '') return radio;
  const group = radioGroup(radio, root);
  return group.find((r) => r.checked) ?? group[0] ?? radio;
}

/** What Tab visits inside `root`, in order: one stop per radio group, as the browser does. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  const stops: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (!isTabbable(el)) continue;
    if (el instanceof HTMLInputElement && el.type === 'radio' && radioStop(el, root) !== el) continue;
    stops.push(el);
  }
  return stops;
}

/**
 * Where Tab (or Shift+Tab) goes from `current`, wrapping at either end so
 * focus stays inside `root`. From outside `root`, the first stop (or the
 * last, backwards). Null when `root` has nothing to focus.
 */
export function nextTabStop(root: HTMLElement, current: Element | null, isBackward: boolean): HTMLElement | null {
  const stops = tabStops(root);
  if (stops.length === 0) return null;
  const from = current instanceof HTMLInputElement && current.type === 'radio' && root.contains(current) ? radioStop(current, root) : current;
  const at = from === null ? -1 : stops.findIndex((s) => s === from || s.contains(from));
  if (at < 0) return (isBackward ? stops[stops.length - 1] : stops[0]) ?? null;
  return stops[(at + (isBackward ? -1 : 1) + stops.length) % stops.length] ?? null;
}

export function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Focus back on `previous` as a dialog or menu closes, unless focus has
 * already gone somewhere on purpose: only when it is still inside `root`
 * or nowhere at all.
 */
export function returnFocus(previous: HTMLElement | null, root: HTMLElement | null): void {
  if (previous === null || !previous.isConnected) return;
  const active = document.activeElement;
  const isLost = active === null || active === document.body || (root !== null && root.contains(active));
  if (isLost) previous.focus();
}
