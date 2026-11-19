import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { requireDocument, requireEngine } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { copySourceRefusal } from '../../app/store/clipboard-slice';
import { pasteInternalClipboard } from '../../app/paste-or-open';
import type { ClipboardData } from '../../app/store/types';

export interface ClipboardResult {
  width: number;
  height: number;
}

const SYSTEM_CLIPBOARD_NOTE =
  'It also copies the pixels to the system clipboard as a PNG, as the menu does, without waiting for that write: a browser that refuses it (no focus or permission) does not fail the command.';

function store() {
  return useEditorStore.getState();
}

function requireCopySource(action: 'copied' | 'cut'): void {
  requireDocument();
  const doc = store().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) throw new CommandError('refused', `There is no active layer to be ${action} from.`);
  const refusal = copySourceRefusal(layer, action);
  if (refusal) throw refusalError(refusal);
  requireEngine();
}

function clipboardResult(before: ClipboardData | null, nothingCopied = 'The engine copied nothing, so the clipboard is unchanged.'): ClipboardResult {
  const { clipboard } = store();
  if (!clipboard || clipboard === before) throw new CommandError('refused', nothingCopied);
  return { width: clipboard.width, height: clipboard.height };
}

/** The store's cut() pushes its "Cut" step before the engine says whether there was anything to cut. */
function nothingCutMessage(historyBefore: number): string {
  const isStepLeft = store().undoStack.length > historyBefore;
  const step = isStepLeft
    ? ' A "Cut" history step was still added, with no change to the pixels, as Edit > Cut adds one: history.undo removes it.'
    : '';
  return `The engine cut nothing (no pixels in the area to cut), so the clipboard is unchanged.${step}`;
}

export const clipboardCopy = defineCommand({
  id: 'clipboard.copy',
  summary: `Copies the active layer's pixels inside the selection (the whole layer when nothing is selected) to the editor's clipboard, as Edit > Copy does (no history step, no pixel change). ${SYSTEM_CLIPBOARD_NOTE} Refused on a group, with the text the menu toasts. Returns the clipboard's width and height in pixels.`,
  surface: 'document',
  params: {},
  run(): ClipboardResult {
    requireCopySource('copied');
    const before = store().clipboard;
    store().copy();
    return clipboardResult(before);
  },
});

export const clipboardCut = defineCommand({
  id: 'clipboard.cut',
  summary: `Copies the active layer's pixels inside the selection (the whole layer when nothing is selected) to the editor's clipboard and clears them from the layer, as Edit > Cut does ("Cut"). ${SYSTEM_CLIPBOARD_NOTE} Refused on a group, with the text the menu toasts. Refused when there are no pixels to cut; as Edit > Cut does, that still leaves a "Cut" history step that changed nothing, and the refusal says so. Returns the clipboard's width and height in pixels.`,
  surface: 'document',
  params: {},
  run(): ClipboardResult {
    requireCopySource('cut');
    const before = store().clipboard;
    const historyBefore = store().undoStack.length;
    store().cut();
    return clipboardResult(before, nothingCutMessage(historyBefore));
  },
});

export const clipboardCopyMerged = defineCommand({
  id: 'clipboard.copy-merged',
  summary: `Copies the composite of every visible layer inside the selection (the whole canvas when nothing is selected) to the editor's clipboard, as Edit > Copy Merged does (no history step). ${SYSTEM_CLIPBOARD_NOTE} Returns the clipboard's width and height in pixels.`,
  surface: 'document',
  params: {},
  run(): Promise<ClipboardResult> {
    requireDocument();
    requireEngine();
    const before = store().clipboard;
    return store().copyMerged().then(() => clipboardResult(before));
  },
});

export const clipboardPaste = defineCommand({
  id: 'clipboard.paste',
  summary:
    'Pastes the editor\'s clipboard in place as a new "Pasted Layer" above the active layer, as Edit > Paste does ("Paste"): the Move tool is chosen and the pasted pixels become the selection. It reads only what clipboard.copy, clipboard.cut or clipboard.copy-merged put there, never the system clipboard (use layer.add-image for an image file). Refused when the clipboard is empty, where the menu does nothing. Returns the new layer\'s id.',
  surface: 'document',
  params: {},
  run(): Promise<{ id: string }> {
    requireDocument();
    requireEngine();
    if (!store().clipboard) {
      throw new CommandError('refused', 'The clipboard is empty: copy or cut something first.');
    }
    const pasted = pasteInternalClipboard();
    if (!pasted) throw new CommandError('refused', 'Nothing was pasted.');
    return pasted.selected.then(() => ({ id: pasted.id }));
  },
});
