import { useEditorStore } from '../../app/editor-store';
import styles from './HistoryPanel.module.css';

export function HistoryPanel() {
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const currentIndex = undoStack.length;

  const handleClick = (index: number) => {
    const diff = index - currentIndex;
    if (diff < 0) {
      for (let i = 0; i < -diff; i++) undo();
    } else if (diff > 0) {
      for (let i = 0; i < diff; i++) redo();
    }
  };

  if (undoStack.length === 0 && redoStack.length === 0) {
    return <div className={styles.empty}>No history</div>;
  }

  return (
    <div className={styles.list}>
      <button
        className={`${styles.entry} ${currentIndex === 0 ? styles.entryActive : ''}`}
        onClick={() => handleClick(0)}
        type="button"
      >
        <span className={styles.index}>0</span>
        <span>Original</span>
      </button>
      {undoStack.map((snapshot, i) => {
        const entryIndex = i + 1;
        return (
          <button
            key={i}
            className={`${styles.entry} ${entryIndex === currentIndex ? styles.entryActive : ''}`}
            onClick={() => handleClick(entryIndex)}
            type="button"
          >
            <span className={styles.index}>{entryIndex}</span>
            <span>{snapshot.label}</span>
          </button>
        );
      })}
      {redoStack.slice().reverse().map((snapshot, i) => {
        const entryIndex = currentIndex + i + 1;
        return (
          <button
            key={`redo-${i}`}
            className={`${styles.entry} ${styles.entryFuture}`}
            onClick={() => handleClick(entryIndex)}
            type="button"
          >
            <span className={styles.index}>{entryIndex}</span>
            <span>{snapshot.label}</span>
          </button>
        );
      })}
    </div>
  );
}
