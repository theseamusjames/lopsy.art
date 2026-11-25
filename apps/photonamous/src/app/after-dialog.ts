import { useUi, type DialogName } from './store';

/**
 * Runs `show` once the named dialog is closed: at once if it is not open.
 *
 * Toasts sit at the bottom right, above dialogs, and stay while the pointer
 * is over them. One shown while a dialog is open can cover the dialog's
 * own footer button on a short window, and then cannot be waited out by
 * someone reaching for that button. What it says belongs after the dialog.
 */
export function afterDialog(name: DialogName, show: () => void): void {
  if (useUi.getState().dialog !== name) {
    show();
    return;
  }
  const stop = useUi.subscribe((state) => {
    if (state.dialog === name) return;
    stop();
    show();
  });
}
