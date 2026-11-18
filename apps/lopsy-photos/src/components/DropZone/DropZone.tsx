import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useUi } from '../../app/store';
import { dragHasFiles, filesFromDataTransfer } from '../../import/collect-files';
import styles from './DropZone.module.css';

/** Accepts files and folders dropped anywhere on the window and opens the import sheet. */
export function DropZone() {
  const [active, setActive] = useState(false);
  const [reading, setReading] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer) || !e.dataTransfer) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      setReading(true);
      filesFromDataTransfer(e.dataTransfer)
        .then((files) => {
          if (files.length > 0) useUi.getState().setPendingImport(files);
        })
        .catch((error: unknown) => console.warn('Could not read the dropped files', error))
        .finally(() => setReading(false));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!active && !reading) return null;
  return (
    <div className={styles.overlay} aria-live="polite">
      <div className={styles.target}>
        <Upload size={32} />
        <p className={styles.title}>{reading ? 'Looking through the files…' : 'Drop to import'}</p>
        {!reading && <p className={styles.hint}>Photos and folders, even a whole memory card</p>}
      </div>
    </div>
  );
}
