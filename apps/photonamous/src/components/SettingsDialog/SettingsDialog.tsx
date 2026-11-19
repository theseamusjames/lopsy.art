import { useEffect, useId, useRef, useState } from 'react';
import type { RepairReport } from '@lopsy/photos-core/library/repair';
import type { KeepOriginals } from '@lopsy/photos-core/cache/keep-originals';
import { getBackend } from '../../app/backend-registry';
import type { DeviceInfo } from '../../app/backend';
import { useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { clearPreviewCache } from '../../app/preview-cache';
import { describeHealth, loadDriveAddMode, saveDriveAddMode, type DriveAddMode } from '../../app/device-settings';
import { formatBytes, plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import { focusedElement } from '../Modal/focus-trap';
import { LeftoverAction } from '../LeftoverAction/LeftoverAction';
import styles from './SettingsDialog.module.css';

const KEEP_CHOICES: readonly { readonly mode: KeepOriginals; readonly label: string; readonly hint: string }[] = [
  { mode: 'recent', label: 'Recent', hint: 'Up to 20 GB; the ones you opened longest ago go first.' },
  { mode: 'all', label: 'All', hint: 'Downloads every original, for working without a connection. Shown in the sync panel.' },
  { mode: 'none', label: 'None', hint: 'Only the photo you are editing.' },
];

/**
 * This device, adding from Drive, the library's health, and closing the
 * library. It opens on its first heading rather than on a button that
 * clears or changes something; Check library's progress and findings are
 * announced.
 */
export function SettingsDialog() {
  const session = useSession();
  const openDialog = useUi((s) => s.openDialog);
  const connection = useUi((s) => s.connection);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [clearing, setClearing] = useState(false);
  const [driveMode, setDriveMode] = useState<DriveAddMode>(loadDriveAddMode);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<RepairReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState('');
  const checkRef = useRef<HTMLButtonElement>(null);
  const driveHeadingId = useId();
  const isDrive = session.adapter.kind === 'google-drive';
  const [keep, setKeep] = useState<KeepOriginals | null>(() => getBackend().getKeepOriginals(session));
  const chooseKeep = (mode: KeepOriginals) => {
    setKeep(mode);
    getBackend()
      .setKeepOriginals(session, mode)
      .then(refreshDevice)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const refreshDevice = () => {
    getBackend()
      .getDeviceInfo(session)
      .then(setDevice)
      .catch(() => setDevice(null));
  };
  useEffect(refreshDevice, [session]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setReport(await getBackend().checkLibrary(session));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      // A Restore or Move button that had focus may have gone with what it fixed.
      if (focusedElement() === null) checkRef.current?.focus();
    }
  };

  const restore = async () => {
    if (!report) return;
    setChecking(true);
    try {
      await getBackend().restoreOriginals(session, report.trashed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await check();
  };

  const addOrphans = () => {
    if (!report) return;
    useUi.getState().setImportJob(getBackend().addOrphans(session, report.orphans));
    openDialog(null);
  };

  return (
    <Modal title="Settings" width="md" onClose={() => openDialog(null)}>
      <div className={styles.sections}>
        <section className={styles.section}>
          <h3 className={styles.heading} tabIndex={-1} data-autofocus>
            This device
          </h3>
          <dl className={styles.facts}>
            <dt>Name</dt>
            <dd>{device?.deviceName ?? '…'}</dd>
            <dt>Library</dt>
            <dd>{connection?.accountLabel}</dd>
            {device?.cacheBytes !== null && (
              <>
                <dt>Kept on this device</dt>
                <dd>{device ? formatBytes(device.cacheBytes ?? 0) : '…'} of originals and previews</dd>
              </>
            )}
          </dl>
          {device?.cacheBytes !== null && (
            <Button
              size="sm"
              aria-disabled={clearing || undefined}
              onClick={async () => {
                setClearing(true);
                const isCleared = await getBackend()
                  .clearDeviceCache(session)
                  .then(
                    () => true,
                    (e: unknown) => {
                      setError(e instanceof Error ? e.message : String(e));
                      return false;
                    },
                  );
                clearPreviewCache();
                setClearing(false);
                if (isCleared) setCleared('Cleared this device’s copies.');
                refreshDevice();
              }}
            >
              Clear this device’s copies
            </Button>
          )}
          <p className={styles.srOnly} role="status">
            {cleared}
          </p>
          {keep !== null && (
            <fieldset className={styles.choices}>
              <legend className={styles.legend}>Keep originals on this device</legend>
              {KEEP_CHOICES.map((choice) => (
                <label key={choice.mode} className={styles.option}>
                  <input type="radio" name="keep-originals" checked={keep === choice.mode} onChange={() => chooseKeep(choice.mode)} />
                  <span>
                    {choice.label}
                    <span className={styles.hint}>{choice.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className={styles.muted}>
            {device?.cacheBytes === null
              ? 'This library is stored in this browser, so there is nothing extra to clear.'
              : 'Photos are fetched again when you open them. Changes not yet saved are kept.'}
          </p>
        </section>

        {isDrive && (
          <section className={styles.section}>
            <h3 className={styles.heading} id={driveHeadingId}>
              Adding from Google Drive
            </h3>
            <div className={styles.group} role="radiogroup" aria-labelledby={driveHeadingId}>
              <label className={styles.option}>
                <input
                  type="radio"
                  name="drive-add"
                  checked={driveMode === 'move'}
                  onChange={() => {
                    setDriveMode('move');
                    saveDriveAddMode('move');
                  }}
                />
                Move them into the library’s Originals folder
              </label>
              <label className={styles.option}>
                <input
                  type="radio"
                  name="drive-add"
                  checked={driveMode === 'leave'}
                  onChange={() => {
                    setDriveMode('leave');
                    saveDriveAddMode('leave');
                  }}
                />
                Leave them where they are in Drive
              </label>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.heading}>Library health</h3>
          <p className={styles.muted}>Checks that every photo’s original is still in storage and unchanged.</p>
          <Button ref={checkRef} size="sm" aria-disabled={checking || undefined} onClick={() => void check()}>
            {checking ? 'Checking…' : 'Check library'}
          </Button>
          <div className={styles.reportRegion} role="status">
            {report && (
              <div className={styles.report}>
                {describeHealth(report).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <div className={styles.actions}>
                  {report.trashed.length > 0 && (
                    <Button size="sm" variant="primary" aria-disabled={checking || undefined} onClick={() => void restore()}>
                      Restore {plural(report.trashed.length, 'original')} from the trash
                    </Button>
                  )}
                  <LeftoverAction leftovers={report.leftovers} disabled={checking} onDone={() => void check()} />
                  {report.orphans.length > 0 && (
                    <Button size="sm" variant="primary" onClick={addOrphans}>
                      Add {plural(report.orphans.length, 'photo')} back to the library
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
