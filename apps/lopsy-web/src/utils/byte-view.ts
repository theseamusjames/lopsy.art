/**
 * A Uint8Array over exactly the bytes a typed array covers. `new
 * Uint8Array(view.buffer)` would span the whole backing buffer, which is
 * wrong for views into a shared buffer (e.g. masks loaded from a project).
 */
export function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
