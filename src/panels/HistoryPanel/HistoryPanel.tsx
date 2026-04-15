import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import styles from './HistoryPanel.module.css';

interface HistoryPanelProps {
  collapsed?: boolean;
}

export function HistoryPanel({ collapsed = false }: HistoryPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const originSnapshotId = useEditorStore((s) => s.originSnapshotId);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const sourceId = useToolSettingsStore((s) => s.historyBrushSourceId);
  const setSourceId = useToolSettingsStore((s) => s.setHistoryBrushSourceId);

  const currentIndex = undoStack.length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [undoStack.length]);

  const handleClick = (index: number) => {
    const diff = index - currentIndex;
    if (diff < 0) {
      for (let i = 0; i < -diff; i++) undo();
    } else if (diff > 0) {
      for (let i = 0; i < diff; i++) redo();
    }
  };

  const handleSetSource = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSourceId(sourceId === id ? null : id);
  };

  if (undoStack.length === 0 && redoStack.length === 0) {
    return <div className={styles.empty}>No history</div>;
  }

  return (
    <div className={collapsed ? styles.listCollapsed : styles.list} ref={listRef}>
      <div className={`${styles.row} ${currentIndex === 0 ? styles.rowActive : ''}`}>
        <button
          className={`${styles.marker} ${sourceId === originSnapshotId ? styles.markerActive : ''}`}
          onClick={(e) => handleSetSource(e, originSnapshotId)}
          title="Use as History Brush source"
          type="button"
          aria-label="Set Original as history brush source"
        >
          {sourceId === originSnapshotId ? <SourceDot /> : null}
        </button>
        <button
          className={styles.entry}
          onClick={() => handleClick(0)}
          type="button"
        >
          <span className={styles.index}>0</span>
          <span>Original</span>
        </button>
      </div>
      {undoStack.map((snapshot, i) => {
        const entryIndex = i + 1;
        const isSource = sourceId === snapshot.id;
        return (
          <div
            key={snapshot.id}
            className={`${styles.row} ${entryIndex === currentIndex ? styles.rowActive : ''}`}
          >
            <button
              className={`${styles.marker} ${isSource ? styles.markerActive : ''}`}
              onClick={(e) => handleSetSource(e, snapshot.id)}
              title="Use as History Brush source"
              type="button"
              aria-label={`Set ${snapshot.label} as history brush source`}
            >
              {isSource ? <SourceDot /> : null}
            </button>
            <button
              className={styles.entry}
              onClick={() => handleClick(entryIndex)}
              type="button"
            >
              <span className={styles.index}>{entryIndex}</span>
              <span>{snapshot.label}</span>
            </button>
          </div>
        );
      })}
      {redoStack.slice().reverse().map((snapshot, i) => {
        const entryIndex = currentIndex + i + 1;
        return (
          <div key={`redo-${snapshot.id}`} className={`${styles.row} ${styles.rowFuture}`}>
            <span className={styles.marker} />
            <button
              className={styles.entry}
              onClick={() => handleClick(entryIndex)}
              type="button"
            >
              <span className={styles.index}>{entryIndex}</span>
              <span>{snapshot.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SourceDot() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="3.5" fill="currentColor" />
    </svg>
  );
}
