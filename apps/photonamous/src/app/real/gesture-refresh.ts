/**
 * Renews the Google token from the user's own clicks.
 *
 * Google's token lasts an hour and has no refresh token; a new one needs
 * Google's popup, which a browser opens only from a click. So every click
 * in the window is offered to the token source, which does nothing until
 * the token is 45 minutes old (`GoogleTokenSource.refreshOnGesture`).
 *
 * A click can pay for one popup, file dialog or clipboard write. The
 * listener is on the window in the bubbling phase, after the app's own
 * handlers, so a control that spends its click at once (a file dialog, a
 * link) has already done so and the renewal's popup is simply refused,
 * to be tried on a later click. A control that spends it later, after
 * waiting for something (the Drive picker, Copy link), would lose it to
 * the renewal, so those clicks are left alone: anything in a menu or a
 * dialog, links, file inputs, and anything marked `data-keeps-gesture`.
 */

/** Clicks the renewal must not take: their own handler needs the browser's leave for a popup. */
const KEEPS_GESTURE = '[data-keeps-gesture], [role="menu"], [role="dialog"], a[href], input[type="file"]';

/** Whether a click on `target` is free for the renewal to use. */
export function isSpareClick(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(KEEPS_GESTURE) === null;
}

interface RenewsOnGesture {
  refreshOnGesture(): Promise<boolean>;
}

interface ClickTarget {
  addEventListener(type: 'click', listener: (event: Event) => void): void;
  removeEventListener(type: 'click', listener: (event: Event) => void): void;
}

/** Offers every spare click to `source` until the returned function is called. */
export function renewOnClicks(source: RenewsOnGesture, target: ClickTarget = window): () => void {
  const handleClick = (event: Event): void => {
    if (!isSpareClick(event.target)) return;
    // The token in use stays good whatever happens, so a failed renewal is not an error to show.
    void source.refreshOnGesture().catch(() => undefined);
  };
  target.addEventListener('click', handleClick);
  return () => target.removeEventListener('click', handleClick);
}
