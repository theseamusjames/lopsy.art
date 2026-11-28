import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Copy, Download, FolderOpen, Images, TriangleAlert, X } from 'lucide-react';
import { missingFilesText, type InterruptedImport as Summary } from '@lopsy/photos-core/import/interrupted';
import { getBackend } from '../../app/backend-registry';
import { downloadBlob } from '../../app/download';
import { useUi } from '../../app/store';
import { showToast } from '../../app/toasts';
import { canPickFolder } from '../../import/collect-files';
import { plural } from '../../import/import-summary';
import { INTERRUPTED_REMEDY, NOT_IMPORTED_FILE_NAME, interruptedAnnouncement, interruptedHeadline } from '../../import/interrupted-words';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './InterruptedImport.module.css';

const ACCEPT = '.raf,.dng,.arw,.jpg,.jpeg,.png,.webp,.xmp,image/jpeg,image/png,image/webp';

/**
 * What a reload left of an import whose files were never staged on this
 * device: one line for the job, how many were imported and how many not,
 * and the remedy, choosing the same photos or folder again (the import
 * then adds only what is missing). The list of files not imported can be
 * shown, copied and downloaded. Dismissing forgets it.
 */
export function InterruptedImport() {
  const summary = useUi((s) => s.interruptedImport);
  const session = useUi((s) => s.connection?.session ?? null);
  const setPendingImport = useUi((s) => s.setPendingImport);
  const [showList, setShowList] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Said once when it appears, not again as its counts change (worked out while rendering, as the strip's voice is).
  const [said, setSaid] = useState<{ summary: Summary; words: string } | null>(null);
  if (summary === null && said !== null) setSaid(null);
  if (summary !== null && said === null) setSaid({ summary, words: interruptedAnnouncement(summary) });
  const voice = (
    <p className={styles.visuallyHidden} role="status">
      {said?.words ?? ''}
    </p>
  );
  if (!summary || !session) return voice;

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) setPendingImport(files);
  };
  const text = missingFilesText(summary.missing);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`Copied the names of ${plural(summary.missing.length, 'photo')} not imported`))
      .catch(() => showToast('The list could not be copied here. Download it instead.'));
  };
  const dismiss = () => {
    useUi.getState().setInterruptedImport(null);
    getBackend()
      .dismissInterruptedImport(session)
      .catch((error: unknown) => console.warn('The interrupted import could not be dismissed', error));
  };

  return (
    <>
      {voice}
      <section className={styles.notice} aria-label="Interrupted import">
        <div className={styles.row}>
          <TriangleAlert size={16} className={styles.warn} aria-hidden />
          <span className={styles.headline}>{interruptedHeadline(summary)}</span>
          <span className={styles.spacer} />
          <IconButton size="sm" label="Dismiss the interrupted import" icon={<X size={14} />} onClick={dismiss} />
        </div>
        <p className={styles.muted}>{INTERRUPTED_REMEDY}</p>
        <div className={styles.row}>
          <Button size="sm" variant="primary" onClick={() => filesRef.current?.click()}>
            <Images size={14} />
            Choose photos again…
          </Button>
          {canPickFolder() && (
            <Button size="sm" onClick={() => folderRef.current?.click()}>
              <FolderOpen size={14} />
              Choose the folder again…
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-expanded={showList} aria-controls={listId} onClick={() => setShowList((s) => !s)}>
            {showList ? 'Hide the list' : `List the ${plural(summary.missing.length, 'photo')} not imported`}
          </Button>
        </div>
        {showList && (
          <div id={listId} className={styles.list}>
            <div className={styles.row}>
              <Button size="sm" variant="ghost" onClick={copy}>
                <Copy size={14} />
                Copy the list
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), NOT_IMPORTED_FILE_NAME)}>
                <Download size={14} />
                Download the list
              </Button>
            </div>
            <ul className={styles.files} aria-label="Photos not imported">
              {summary.missing.map((file, i) => (
                <li key={`${i}:${file.fileName}`} className={styles.file}>
                  {file.fileName}
                </li>
              ))}
            </ul>
          </div>
        )}
        <input ref={filesRef} className={styles.hidden} type="file" multiple accept={ACCEPT} onChange={onPicked} aria-hidden tabIndex={-1} />
        <input ref={folderRef} className={styles.hidden} type="file" multiple onChange={onPicked} aria-hidden tabIndex={-1} {...{ webkitdirectory: '' }} />
      </section>
    </>
  );
}
