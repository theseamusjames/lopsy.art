import { useCallback, type RefObject } from 'react';
import { Check, X } from 'lucide-react';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { commitTextEditing } from '../../app/interactions/misc-handlers';
import styles from './TextActionButtons.module.css';

interface TextActionButtonsProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function TextActionButtons({ containerRef }: TextActionButtonsProps) {
  const textEditing = useUIStore((s) => s.textEditing);
  const viewport = useEditorStore((s) => s.viewport);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  const handleCommit = useCallback(() => {
    commitTextEditing();
  }, []);

  const handleCancel = useCallback(() => {
    const editing = useUIStore.getState().textEditing;
    if (!editing) return;
    const editorState = useEditorStore.getState();
    if (editing.isNew) {
      editorState.removeLayer(editing.layerId);
    }
    // For existing layers, the pixel data was modified in real-time.
    // Cancelling just stops editing — user can undo to revert.
    useUIStore.getState().cancelTextEditing();
    editorState.notifyRender();
  }, []);

  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!textEditing) return null;

  const container = containerRef.current;
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const screenX =
    viewport.panX + cx +
    (textEditing.bounds.x - docWidth / 2) * viewport.zoom;
  const screenY =
    viewport.panY + cy +
    (textEditing.bounds.y - docHeight / 2) * viewport.zoom;

  const buttonX = screenX - 36;
  const buttonY = screenY;

  return (
    <div
      className={styles.container}
      style={{ left: buttonX, top: buttonY }}
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onMouseMove={stopPropagation}
    >
      <button
        className={styles.commitButton}
        onClick={handleCommit}
        aria-label="Commit text"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className={styles.cancelButton}
        onClick={handleCancel}
        aria-label="Cancel text"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
