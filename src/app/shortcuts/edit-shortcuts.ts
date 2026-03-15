import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { selectAll, invertSelectionAction } from '../MenuBar/menus/select-menu';

export function handleEditShortcut(
  e: KeyboardEvent,
  clearPersistentTransform: () => void,
): boolean {
  if (e.key === 'c') {
    e.preventDefault();
    useEditorStore.getState().copy();
    return true;
  }
  if (e.key === 'x') {
    e.preventDefault();
    useEditorStore.getState().cut();
    return true;
  }
  if (e.key === 'v') {
    e.preventDefault();
    navigator.clipboard.read().then(async (items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            useEditorStore.getState().pasteImageData(imageData);
          }
          bitmap.close();
          return;
        }
      }
      useEditorStore.getState().paste();
    }).catch(() => {
      useEditorStore.getState().paste();
    });
    return true;
  }
  if (e.key === 'e') {
    e.preventDefault();
    useEditorStore.getState().mergeDown();
    return true;
  }
  if (e.key === 'a') {
    e.preventDefault();
    selectAll();
    return true;
  }
  if ((e.key === 'i' || e.key === 'I') && e.shiftKey) {
    e.preventDefault();
    invertSelectionAction();
    return true;
  }
  if (e.key === 'd') {
    e.preventDefault();
    useEditorStore.getState().clearSelection();
    useUIStore.getState().setTransform(null);
    clearPersistentTransform();
    return true;
  }
  if (e.key === "'") {
    e.preventDefault();
    useUIStore.getState().toggleGrid();
    return true;
  }
  if (e.key === ';') {
    e.preventDefault();
    useUIStore.getState().toggleGuides();
    return true;
  }
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault();
    if (e.shiftKey) {
      useEditorStore.getState().redo();
    } else {
      useEditorStore.getState().undo();
    }
    return true;
  }
  return false;
}
