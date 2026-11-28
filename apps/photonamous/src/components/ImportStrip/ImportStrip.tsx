import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { useImportProgress, useLibraryView } from '../../app/hooks';
import { isHiddenPairHalf } from '../../library/asset-query';
import { useUi } from '../../app/store';
import { getBackend } from '../../app/backend-registry';
import { showToast } from '../../app/toasts';
import { endedCleanly, estimateLeft, importHeadline, importStats } from '../../import/import-progress';
import { plural } from '../../import/import-summary';
import type { ImportJob } from '@lopsy/photos-core/import/types';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { announceImport, type Announced, type ImportFacts } from './import-announcer';
import { importFileErrors } from '../../app/file-error-events';
import { track } from '../../app/track';
import styles from './ImportStrip.module.css';

/** The imports whose refused files have been reported: once each, when it ends. */
const reportedJobs = new WeakSet<ImportJob>();

/**
 * The progress strip while an import runs. An import that ends cleanly
 * leaves it: its outcome is a toast, held while hovered or focused. Any
 * other end keeps the strip, with Retry or Resume and what failed, until
 * it is dismissed.
 */
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
  // The files the import refused (it lists them under "could not be imported"), reported once it ends, one event per reason.
  useEffect(() => {
    if (!job || !progress?.finished || reportedJobs.has(job)) return;
    reportedJobs.add(job);
    for (const error of importFileErrors(progress.items)) track.error(error);
  }, [job, progress]);
  const view = useLibraryView();
  // The JPEG half of a RAW+JPEG pair is a file but not a photo of its own: count photos as the grid does.
  const pairHalves = useMemo(
    () =>
      progress?.finished
        ? progress.items.filter((item) => {
            const asset = item.state === 'done' && item.assetId !== null ? view.assets.get(item.assetId) : undefined;
            return asset !== undefined && isHiddenPairHalf(asset, view.assets);
          }).length
        : 0,
    [progress, view.assets],
  );
  const facts = useMemo<ImportFacts | null>(
    () =>
      progress && stats
        ? {
            total: stats.total,
            settled: stats.settled,
            fraction: stats.fraction,
            finished: progress.finished,
            failed: stats.failed.length,
            added: stats.done - pairHalves,
            skipped: stats.duplicates,
            waiting: stats.waiting.length,
            paused: stats.paused,
          }
        : null,
    [progress, stats, pairHalves],
  );
  const isClean = facts !== null && endedCleanly(facts);
  const headline = progress && stats ? importHeadline(progress, stats, pairHalves) : null;
  // The strip changes every second; a screen reader hears the start, each quarter and the end (import-announcer).
  const [said, setSaid] = useState<{ job: ImportJob; announced: Announced } | null>(null);
  useEffect(() => {
    if (!job || !facts) return setSaid(null);
    setSaid((before) => {
      const announced = announceImport(before?.job === job ? before.announced : null, facts);
      return before?.job === job && before.announced === announced ? before : { job, announced };
    });
  }, [job, facts]);
  // A clean end needs no row of its own: its outcome becomes a toast (which says it to a screen reader) and the strip goes.
  useEffect(() => {
    if (!job || !isClean || headline === null) return;
    showToast(headline);
    if (useUi.getState().importJob === job) setImportJob(null);
  }, [job, isClean, headline, setImportJob]);
  const voice = (
    <>
      <p className={styles.visuallyHidden} role="status">
        {said?.announced.polite ?? ''}
      </p>
      <p className={styles.visuallyHidden} role="alert">
        {said?.announced.alert ?? ''}
      </p>
    </>
  );

  if (!job || !progress || !stats || isClean) return voice;

  const left = progress.finished ? null : estimateLeft(stats, now - started.current);
  const paused = progress.finished && stats.paused > 0;
  const waiting = stats.waiting.length;

  return (
    <>
      {voice}
      <section className={styles.strip} aria-label="Import">
        <div className={styles.row}>
          {progress.finished && !paused && waiting === 0 && <Check size={16} className={styles.ok} />}
          <span className={styles.headline}>{headline}</span>
          {left && <span className={styles.muted}>{left}</span>}
          {waiting > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowFailures((s) => !s)}>
              <span className={styles.warn}>{plural(waiting, 'photo')} waiting to retry</span>
            </Button>
          )}
          {stats.failed.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowFailures((s) => !s)}>
              <TriangleAlert size={14} className={styles.bad} />
              {plural(stats.failed.length, 'photo')} could not be imported
            </Button>
          )}
          <span className={styles.spacer} />
          {paused ? (
            <Button size="sm" variant="primary" onClick={resume}>
              Resume
            </Button>
          ) : progress.finished && waiting > 0 ? (
            <Button size="sm" variant="primary" onClick={resume}>
              Retry
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
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Import"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stats.fraction * 100)}
          >
            <span className={styles.fill} style={{ '--fraction': `${stats.fraction * 100}%` } as React.CSSProperties} />
          </div>
        )}
        {showFailures && (
          <ul className={styles.failures}>
            {[...stats.waiting, ...stats.failed].map((f) => (
              <li key={f.id}>
                <span className={styles.file}>{f.fileName}</span>
                <span className={styles.muted}>{f.error ?? 'Failed'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
