import { useCallback, type RefObject } from 'react';
import { Check, X } from 'lucide-react';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { commitTextEditing, cancelTextEditing } from '../../tools/text/text-interaction';
import styles from './TextActionButtons.module.css';

interface TextActionButtonsProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function TextActionButtons({ containerRef }: TextActionButtonsProps) {
  const textEditing = useUIStore((s) => s.textEditing);
  const viewport = useEditorStore((s) => s.viewport);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  // Transformed text can run any direction from its anchor, so dock the
  // buttons beside its texture's top-left instead of over the glyphs.
  const editedLayer = useEditorStore((s) =>
    textEditing?.matrix ? s.document.layers.find((l) => l.id === textEditing.layerId) ?? null : null,
  );

  const handleCommit = useCallback(() => {
    commitTextEditing();
  }, []);

  const handleCancel = useCallback(() => {
    cancelTextEditing();
  }, []);

  const stopPropagation = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!textEditing) return null;

  const container = containerRef.current;
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const originX = editedLayer?.x ?? textEditing.bounds.x;
  const originY = editedLayer?.y ?? textEditing.bounds.y;
  const screenX =
    viewport.panX + cx +
    (originX - docWidth / 2) * viewport.zoom;
  const screenY =
    viewport.panY + cy +
    (originY - docHeight / 2) * viewport.zoom;

  const buttonX = screenX - 36;
  const buttonY = screenY;

  return (
    <div
      className={styles.container}
      style={{ '--buttons-x': `${buttonX}px`, '--buttons-y': `${buttonY}px` } as React.CSSProperties}
      onPointerDown={stopPropagation}
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
