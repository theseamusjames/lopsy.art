import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useImportProgress } from '../../app/hooks';
import { useUi } from '../../app/store';
import { getBackend } from '../../app/backend-registry';
import { estimateLeft, importStats } from '../../import/import-progress';
import { formatBytes, plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './ImportStrip.module.css';

/** The progress strip while an import runs, and its outcome afterwards. */
export function ImportStrip() {
  const job = useUi((s) => s.importJob);
  const setImportJob = useUi((s) => s.setImportJob);
  const progress = useImportProgress(job);
  const [showFailures, setShowFailures] = useState(false);
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    started.current = Date.now();
    setShowFailures(false);
  }, [job]);

  useEffect(() => {
    if (!progress || progress.finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [progress]);

  const resume = () => {
    const session = useUi.getState().connection?.session;
    if (!session) return;
    getBackend()
      .resumeImports(session)
      .then((next) => setImportJob(next))
      .catch((error: unknown) => console.warn('The import could not be resumed', error));
  };

  const stats = useMemo(() => (progress ? importStats(progress) : null), [progress]);
  if (!job || !progress || !stats) return null;

  const left = progress.finished ? null : estimateLeft(stats, now - started.current);
  const paused = progress.finished && stats.paused > 0;
  const headline = paused
    ? `Import paused · ${plural(stats.paused, 'photo')} still to go`
    : progress.finished
    ? `Imported ${plural(stats.done, 'photo')}${stats.duplicates > 0 ? `, skipped ${stats.duplicates} already in the library` : ''}`
    : `Importing ${stats.settled.toLocaleString()} of ${plural(stats.total, 'photo')} · ${formatBytes(stats.totalBytes - stats.sentBytes)} left`;

  return (
    <section className={styles.strip} aria-label="Import" aria-live="polite">
      <div className={styles.row}>
        {progress.finished && !paused && <Check size={16} className={styles.ok} />}
        <span className={styles.headline}>{headline}</span>
        {left && <span className={styles.muted}>{left}</span>}
        {stats.failed.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowFailures((s) => !s)}>
            <span className={styles.bad}>{plural(stats.failed.length, 'photo')} could not be imported</span>
          </Button>
        )}
        <span className={styles.spacer} />
        {paused ? (
          <Button size="sm" variant="primary" onClick={resume}>
            Resume
          </Button>
        ) : progress.finished ? (
          <IconButton size="sm" label="Dismiss" icon={<X size={14} />} onClick={() => setImportJob(null)} />
        ) : (
          <>
            <Button size="sm" onClick={() => job.pause()}>
              Pause
            </Button>
            <Button size="sm" variant="ghost" onClick={() => job.cancel()}>
              Stop
            </Button>
          </>
        )}
      </div>
      {!progress.finished && (
        <div className={styles.bar}>
          <span className={styles.fill} style={{ '--fraction': `${stats.fraction * 100}%` } as React.CSSProperties} />
        </div>
      )}
      {showFailures && (
        <ul className={styles.failures}>
          {stats.failed.map((f) => (
            <li key={f.id}>
              <span className={styles.file}>{f.fileName}</span>
              <span className={styles.muted}>{f.error ?? 'Failed'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
