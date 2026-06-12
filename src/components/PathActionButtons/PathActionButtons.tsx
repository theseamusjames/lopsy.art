import { useCallback, type RefObject } from 'react';
import { Check, X } from 'lucide-react';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { commitCurrentPath } from '../../app/interactions/path-stroke';
import type { PathAnchor } from '../../app/ui-store';
import styles from './PathActionButtons.module.css';

// Stable reference so the selector returns the same array when the draft
// is null — useUIStore would otherwise see a fresh `[]` every render and
// re-fire the subscription.
const EMPTY_ANCHORS: PathAnchor[] = [];

interface PathActionButtonsProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function PathActionButtons({ containerRef }: PathActionButtonsProps) {
  const pathAnchors = useUIStore((s) => s.pathDraft?.anchors ?? EMPTY_ANCHORS);
  const viewport = useEditorStore((s) => s.viewport);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);

  const handleCommit = useCallback(() => {
    commitCurrentPath();
  }, []);

  const handleCancel = useCallback(() => {
    useUIStore.getState().clearPath();
    useEditorStore.getState().notifyRender();
  }, []);

  const stopPropagation = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (pathAnchors.length < 2) return null;

  const container = containerRef.current;
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const activeLayer = useEditorStore.getState().document.layers.find(
    (l) => l.id === activeLayerId,
  );
  const offsetX = activeLayer?.x ?? 0;
  const offsetY = activeLayer?.y ?? 0;

  const firstAnchor = pathAnchors[0]!;
  const docX = firstAnchor.point.x + offsetX;
  const docY = firstAnchor.point.y + offsetY;

  const screenX = viewport.panX + cx + (docX - docWidth / 2) * viewport.zoom;
  const screenY = viewport.panY + cy + (docY - docHeight / 2) * viewport.zoom;

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
        aria-label="Commit path"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className={styles.cancelButton}
        onClick={handleCancel}
        aria-label="Cancel path"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
