/**
 * Helpers for deciding whether an image pasted from the system clipboard is a
 * paste-back of content that was copied inside the app. Kept free of engine /
 * store imports so the matching logic stays pure and unit-testable.
 *
 * The decision is made by comparing the incoming PNG blob's bytes against the
 * bytes the app last handed to `navigator.clipboard.write`. This avoids
 * reading the clipboard texture back from the GPU on every paste (#724) —
 * the OS clipboard delivers whatever bytes we wrote, so identical bytes are
 * proof it is still our own copy.
 */

let lastCopyPngBytes: Uint8Array | null = null;

/** Record the PNG bytes the app just wrote to the system clipboard. */
export function setLastCopyPngBytes(bytes: Uint8Array | null): void {
  lastCopyPngBytes = bytes;
}

/** The PNG bytes of the last app-authored copy, or null before the first copy. */
export function getLastCopyPngBytes(): Uint8Array | null {
  return lastCopyPngBytes;
}

/**
 * Whether two PNG-blob byte streams are identical. The system clipboard
 * preserves exact bytes across major platforms, so exact equality is a
 * definitive "still our own copy" signal — no GPU readback required.
 */
export function pngBytesMatch(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
