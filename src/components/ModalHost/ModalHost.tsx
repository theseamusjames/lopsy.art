import { useCallback, useEffect } from 'react';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { pasteOrOpenBlob } from '../../app/paste-or-open';
import { importPsdFile } from '../../io/psd';
import { describeError, notifyError } from '../../app/notifications-store';
import { confirmShapeSize } from '../../tools/shape/shape-interaction';
import { NewDocumentModal } from '../NewDocumentModal/NewDocumentModal';
import { ShapeSizeModal } from '../ShapeSizeModal/ShapeSizeModal';
import { BrushModal } from '../BrushModal/BrushModal';
import { StrokePathModal } from '../StrokePathModal/StrokePathModal';

/**
 * Renders whichever modal is currently open in the ui-store slot. Also
 * centralizes ESC-to-close for dismissible modals so each individual modal
 * component doesn't have to reinvent that effect.
 *
 * The pre-document `NewDocumentModal` render path stays in App.tsx — it
 * needs an app-wide drag/drop wrapper and isn't dismissible, so routing
 * it through here would just add a conditional branch without simplifying
 * anything.
 */
export function ModalHost() {
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);

  // ESC closes any modal that has a cancel path. BrushModal and
  // StrokePathModal own their own ESC handling today; we only handle the
  // two that didn't before (NewDocument and ShapeSize) to avoid double-firing.
  useEffect(() => {
    if (!modal) return;
    if (modal.kind !== 'newDocument' && modal.kind !== 'shapeSize') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);

  const handleCreateDocument = useCallback(
    (width: number, height: number, background: 'white' | 'transparent') => {
      useEditorStore.getState().createDocument(width, height, background === 'transparent');
      closeModal();
    },
    [closeModal],
  );

  const handleOpenFile = useCallback(
    (file: File) => {
      const name = file.name.replace(/\.[^.]+$/, '');
      if (/\.psd$/i.test(file.name)) {
        file
          .arrayBuffer()
          .then((buffer) => importPsdFile(new Uint8Array(buffer), name))
          .then(() => closeModal())
          .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
        return;
      }
      pasteOrOpenBlob(file, name)
        .then(() => closeModal())
        .catch((err) => notifyError(`Failed to open file: ${describeError(err)}`));
    },
    [closeModal],
  );

  const handlePasteClipboard = useCallback(
    (blob: Blob) => {
      pasteOrOpenBlob(blob, 'Copied File')
        .then(() => closeModal())
        .catch((err) => notifyError(`Failed to paste image: ${describeError(err)}`));
    },
    [closeModal],
  );

  const handleShapeSizeConfirm = useCallback(
    (width: number, height: number) => {
      if (modal?.kind !== 'shapeSize') return;
      confirmShapeSize(width, height, modal.click);
      closeModal();
    },
    [modal, closeModal],
  );

  if (!modal) return null;

  switch (modal.kind) {
    case 'newDocument':
      return (
        <NewDocumentModal
          onCreateDocument={handleCreateDocument}
          onOpenFile={handleOpenFile}
          onPasteClipboard={handlePasteClipboard}
          onCancel={closeModal}
        />
      );
    case 'shapeSize':
      return <ShapeSizeModal onConfirm={handleShapeSizeConfirm} onCancel={closeModal} />;
    case 'brush':
      return <BrushModal />;
    case 'strokePath':
      // StrokePathModal still reads modal.pathId directly from the store so
      // its own close path works without our handlers.
      return <StrokePathModal />;
    case 'guideColor':
      // Rendered separately in App.tsx — it needs canvas-container-relative
      // positioning, not the fixed overlay a ModalHost provides.
      return null;
    case 'loading':
      return <LoadingOverlay message={modal.message} />;
  }
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.6)', zIndex: 9999,
    }} role="dialog" aria-label={message}>
      <div style={{
        background: 'var(--color-bg-secondary, #1e1e1e)',
        borderRadius: 'var(--radius-lg, 8px)',
        padding: '24px 32px',
        color: 'var(--color-text-primary, #e0e0e0)',
        fontSize: 'var(--font-size-sm, 13px)',
      }}>
        {message}
      </div>
    </div>
  );
}
