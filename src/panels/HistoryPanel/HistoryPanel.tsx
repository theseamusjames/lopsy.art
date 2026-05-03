import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import styles from './HistoryPanel.module.css';

export function HistoryPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('history');
  const listRef = useRef<HTMLDivElement>(null);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const historyBrushSourceIndex = useUIStore((s) => s.historyBrushSourceIndex);
  const setHistoryBrushSourceIndex = useUIStore((s) => s.setHistoryBrushSourceIndex);

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

  const handleSetSource = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setHistoryBrushSourceIndex(historyBrushSourceIndex === index ? null : index);
  };

  return (
    <PanelContainer title="History" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
      {undoStack.length === 0 && redoStack.length === 0 ? (
        <div className={styles.empty}>No history</div>
      ) : (
        <div className={collapsed ? styles.listCollapsed : styles.list} ref={listRef}>
          <div className={styles.entryRow}>
            <button
              className={`${styles.entry} ${currentIndex === 0 ? styles.entryActive : ''}`}
              onClick={() => handleClick(0)}
              type="button"
            >
              <span className={styles.index}>0</span>
              <span>Original</span>
            </button>
            <button
              className={`${styles.sourceBtn} ${historyBrushSourceIndex === 0 ? styles.sourceBtnActive : ''}`}
              onClick={(e) => handleSetSource(e, 0)}
              type="button"
              aria-label="Set as history brush source"
              title="Set as history brush source"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
          </div>
          {undoStack.map((snapshot, i) => {
            const entryIndex = i + 1;
            return (
              <div key={i} className={styles.entryRow}>
                <button
                  className={`${styles.entry} ${entryIndex === currentIndex ? styles.entryActive : ''}`}
                  onClick={() => handleClick(entryIndex)}
                  type="button"
                >
                  <span className={styles.index}>{entryIndex}</span>
                  <span>{snapshot.label}</span>
                </button>
                <button
                  className={`${styles.sourceBtn} ${historyBrushSourceIndex === entryIndex ? styles.sourceBtnActive : ''}`}
                  onClick={(e) => handleSetSource(e, entryIndex)}
                  type="button"
                  aria-label="Set as history brush source"
                  title="Set as history brush source"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  </svg>
                </button>
              </div>
            );
          })}
          {redoStack.slice().reverse().map((snapshot, i) => {
            const entryIndex = currentIndex + i + 1;
            return (
              <div key={`redo-${i}`} className={styles.entryRow}>
                <button
                  className={`${styles.entry} ${styles.entryFuture}`}
                  onClick={() => handleClick(entryIndex)}
                  type="button"
                >
                  <span className={styles.index}>{entryIndex}</span>
                  <span>{snapshot.label}</span>
                </button>
                <button
                  className={`${styles.sourceBtn} ${styles.entryFuture}`}
                  onClick={(e) => handleSetSource(e, entryIndex)}
                  type="button"
                  aria-label="Set as history brush source"
                  title="Set as history brush source"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </PanelContainer>
  );
}
