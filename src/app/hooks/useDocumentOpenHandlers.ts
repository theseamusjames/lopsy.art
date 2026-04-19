import { useCallback } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { pasteOrOpenBlob } from '../paste-or-open';
import { importPsdFile } from '../../io/psd';
import { importDngFile } from '../../io/dng';
import { describeError, notifyError } from '../notifications-store';

export interface DocumentOpenHandlers {
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handlePreDocCreate: (width: number, height: number, background: 'white' | 'transparent') => void;
  handlePreDocOpenFile: (file: File) => void;
  handlePreDocPasteClipboard: (blob: Blob) => void;
}

export function useDocumentOpenHandlers(): DocumentOpenHandlers {
  const closeModal = useUIStore((s) => s.closeModal);
  const closeModalOfKind = useUIStore((s) => s.closeModalOfKind);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const name = file.name.replace(/\.[^.]+$/, '');

    if (/\.dng$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => { importDngFile(new Uint8Array(buffer), name); closeModalOfKind('newDocument'); })
        .catch((err) => notifyError(`Failed to import DNG: ${describeError(err)}`));
      return;
    }

    if (!file.type.startsWith('image/')) return;

    pasteOrOpenBlob(file, name)
      .then(() => closeModalOfKind('newDocument'))
      .catch((err) => notifyError(`Failed to open file: ${describeError(err)}`));
  }, [closeModalOfKind]);

  const handlePreDocCreate = useCallback(
    (width: number, height: number, background: 'white' | 'transparent') => {
      useEditorStore.getState().createDocument(width, height, background === 'transparent');
      closeModal();
    },
    [closeModal],
  );

  const handlePreDocOpenFile = useCallback((file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.psd$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => importPsdFile(new Uint8Array(buffer), name))
        .then(() => closeModal())
        .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
      return;
    }
    if (/\.dng$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => { importDngFile(new Uint8Array(buffer), name); closeModal(); })
        .catch((err) => notifyError(`Failed to import DNG: ${describeError(err)}`));
      return;
    }
    pasteOrOpenBlob(file, name)
      .then(() => closeModal())
      .catch((err) => notifyError(`Failed to open file: ${describeError(err)}`));
  }, [closeModal]);

  const handlePreDocPasteClipboard = useCallback(
    (blob: Blob) => {
      pasteOrOpenBlob(blob, 'Copied File')
        .then(() => closeModal())
        .catch((err) => notifyError(`Failed to paste image: ${describeError(err)}`));
    },
    [closeModal],
  );

  return {
    handleDragOver,
    handleDrop,
    handlePreDocCreate,
    handlePreDocOpenFile,
    handlePreDocPasteClipboard,
  };
}
