/**
 * True while a modal dialog (one rendered over a blocking overlay and
 * marked `aria-modal="true"`) is open. Global editor shortcuts stand down
 * then: with focus outside the dialog's inputs, Backspace used to delete
 * the active layer behind the Marquee Region and filter dialogs, ⌘Z undid
 * canvas history and tool letters switched tools (#1047).
 */
export function isModalDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
