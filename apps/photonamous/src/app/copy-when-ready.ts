/**
 * Copies text that is still on its way, such as a link the storage is
 * being asked for.
 *
 * Safari lets a page write to the clipboard only in answer to a click, and
 * counts a write begun after waiting for the network as too late. A write
 * *started* inside the click with a promise for its content is allowed to
 * finish whenever the promise does, so that is tried first; call this
 * before the first `await` of the click's handler. Browsers without that
 * form get the plain write once the text is here, which Chrome and Firefox
 * allow shortly after a click.
 *
 * Resolves true when the text reached the clipboard. It never rejects: a
 * failure to get the text is the caller's to report from its own promise.
 */
export async function copyWhenReady(text: Promise<string>): Promise<boolean> {
  const clipboard: Clipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard) {
    await text.catch(() => undefined);
    return false;
  }
  if (typeof ClipboardItem === 'function' && typeof clipboard.write === 'function') {
    try {
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      // Refused, or the text never came: the plain write below finds out which.
    }
  }
  try {
    await clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
