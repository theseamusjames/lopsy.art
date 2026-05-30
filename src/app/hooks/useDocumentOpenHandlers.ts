import { useCallback } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { pasteOrOpenBlob } from '../paste-or-open';
import { importPsdFile } from '../../io/psd';
import { importDngFile } from '../../io/dng';
import { loadProject } from '../../io/project-load';
import { describeError, notifyError } from '../notifications-store';

/** What to do with a user-supplied file based on its name. Pure: no IO.
 *  Drives both the file-picker handlers below and the drag-and-drop path. */
export type OpenFileKind = 'lopsy' | 'psd' | 'dng' | 'image' | 'unsupported';

export function classifyOpenFile(file: File): OpenFileKind {
  if (/\.lopsy$/i.test(file.name)) return 'lopsy';
  if (/\.psd$/i.test(file.name)) return 'psd';
  if (/\.dng$/i.test(file.name)) return 'dng';
  if (file.type.startsWith('image/')) return 'image';
  return 'unsupported';
}

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
    const close = () => closeModalOfKind('newDocument');

    switch (classifyOpenFile(file)) {
      case 'lopsy':
        loadProject(file)
          .then(close)
          .catch((err) => notifyError(`Failed to open project: ${describeError(err)}`));
        return;
      case 'psd':
        file
          .arrayBuffer()
          .then((buffer) => importPsdFile(new Uint8Array(buffer), name).then(close))
          .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
        return;
      case 'dng':
        file
          .arrayBuffer()
          .then((buffer) => importDngFile(new Uint8Array(buffer), name).then(close))
          .catch((err) => notifyError(`Failed to import DNG: ${describeError(err)}`));
        return;
      case 'image':
        pasteOrOpenBlob(file, name)
          .then(close)
          .catch((err) => notifyError(`Failed to open file: ${describeError(err)}`));
        return;
      case 'unsupported':
        return;
    }
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
    const close = () => closeModal();

    switch (classifyOpenFile(file)) {
      case 'lopsy':
        loadProject(file)
          .then(close)
          .catch((err) => notifyError(`Failed to open project: ${describeError(err)}`));
        return;
      case 'psd':
        file
          .arrayBuffer()
          .then((buffer) => importPsdFile(new Uint8Array(buffer), name))
          .then(close)
          .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
        return;
      case 'dng':
        file
          .arrayBuffer()
          .then((buffer) => importDngFile(new Uint8Array(buffer), name).then(close))
          .catch((err) => notifyError(`Failed to import DNG: ${describeError(err)}`));
        return;
      case 'image':
      case 'unsupported':
        // Fall through to pasteOrOpenBlob, which raises a friendly error for
        // genuinely unsupported types.
        pasteOrOpenBlob(file, name)
          .then(close)
          .catch((err) => notifyError(`Failed to open file: ${describeError(err)}`));
        return;
    }
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
