/**
 * Tracks whether the OS clipboard has caught up with the most recent in-app
 * Copy / Cut / Copy Merged.
 *
 * Those actions stage pixels in the GPU clipboard synchronously but mirror
 * them to the OS clipboard asynchronously (GPU readback → PNG encode →
 * `navigator.clipboard.write`). A paste that arrives inside that window reads
 * the *previous* OS clipboard image, which then fails the internal paste-back
 * match and lands at 0,0 as an external image (#960). While the in-app copy is
 * newer than the OS clipboard, the paste handler must use the internal
 * clipboard instead.
 *
 * A failed write also leaves the in-app copy newer. That lasts until the
 * window loses focus, since copying in another app requires leaving this one.
 */

let latestSeq = 0;
let isInternalNewer = false;

/** Call when an in-app copy starts. Returns a token for `completeSystemClipboardWrite`. */
export function beginSystemClipboardWrite(): number {
  latestSeq += 1;
  isInternalNewer = true;
  return latestSeq;
}

/**
 * Whether the write for `seq` should still go to the OS clipboard. A later
 * copy supersedes it, and writing it afterwards would put stale pixels back.
 */
export function isSystemClipboardWriteCurrent(seq: number): boolean {
  return seq === latestSeq;
}

/** Call once the OS clipboard write for `seq` has resolved successfully. */
export function completeSystemClipboardWrite(seq: number): void {
  if (seq !== latestSeq) return;
  isInternalNewer = false;
}

/** The OS clipboard may now hold something copied outside the app. */
export function invalidateInternalClipboardPriority(): void {
  isInternalNewer = false;
}

/** True while the OS clipboard does not yet hold the latest in-app copy. */
export function isInternalClipboardNewer(): boolean {
  return isInternalNewer;
}
