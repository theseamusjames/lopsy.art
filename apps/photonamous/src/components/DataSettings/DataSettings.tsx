import { useRef, useState } from 'react';
import type { RepairReport } from '@lopsy/photos-core/library/repair';
import type { KeepOriginals } from '@lopsy/photos-core/cache/keep-originals';
import { getBackend } from '../../app/backend-registry';
import type { DeviceInfo } from '../../app/backend';
import { useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { clearPreviewCache } from '../../app/preview-cache';
import { describeHealth } from '../../app/device-settings';
import { formatBytes, plural } from '../../import/import-summary';
import { focusedElement } from '@lopsy/ui/a11y/focus-trap';
import { Button } from '../Button/Button';
import { LeftoverAction } from '../LeftoverAction/LeftoverAction';
import { SettingsSection } from '../SettingsSection/SettingsSection';
import form from '../SettingsSection/settings-form.module.css';
import styles from './DataSettings.module.css';

const KEEP_CHOICES: readonly { readonly mode: KeepOriginals; readonly label: string; readonly hint: string }[] = [
  { mode: 'recent', label: 'Recent', hint: 'Up to 20 GB; the ones you opened longest ago go first.' },
  { mode: 'all', label: 'All', hint: 'Downloads every original, for working without a connection. Shown in the sync panel.' },
  { mode: 'none', label: 'None', hint: 'Only the photo you are editing.' },
];

interface DataSettingsProps {
  /** What this device keeps; null while it is read, or when it could not be. */
  readonly device: DeviceInfo | null;
  /** Reads `device` again, after something changed what is kept. */
  readonly onDeviceChange: () => void;
}

/**
 * Settings > Data: what this device keeps of the library, and the library's
 * health. Check library's progress and findings are announced.
 */
export function DataSettings({ device, onDeviceChange }: DataSettingsProps) {
  const session = useSession();
  const openDialog = useUi((s) => s.openDialog);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState('');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<RepairReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  const [keep, setKeep] = useState<KeepOriginals | null>(() => getBackend().getKeepOriginals(session));
  /** The library is in this browser already: there are no copies to keep or clear. */
  const keepsNothing = device?.cacheBytes === null;

  const chooseKeep = (mode: KeepOriginals) => {
    setKeep(mode);
    getBackend()
      .setKeepOriginals(session, mode)
      .then(onDeviceChange)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const clear = async () => {
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
    onDeviceChange();
  };

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
    <>
      <SettingsSection title="Kept on this device">
        {keepsNothing ? (
          <p className={form.muted}>This library is stored in this browser, so there is nothing extra to keep or clear.</p>
        ) : (
          <>
            <dl className={form.facts}>
              <dt>In use</dt>
              <dd>{device ? formatBytes(device.cacheBytes ?? 0) : '…'} of originals and previews</dd>
            </dl>
            {keep !== null && (
              <fieldset className={form.choices}>
                <legend className={form.legend}>Keep originals on this device</legend>
                {KEEP_CHOICES.map((choice) => (
                  <label key={choice.mode} className={form.option}>
                    <input type="radio" name="keep-originals" checked={keep === choice.mode} onChange={() => chooseKeep(choice.mode)} />
                    <span>
                      {choice.label}
                      <span className={form.hint}>{choice.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Button size="sm" aria-disabled={clearing || undefined} onClick={() => void clear()}>
              Clear this device’s copies
            </Button>
            <p className={form.muted}>Photos are fetched again when you open them. Changes not yet saved are kept.</p>
          </>
        )}
        <p className={form.srOnly} role="status">
          {cleared}
        </p>
      </SettingsSection>

      <SettingsSection title="Library health">
        <p className={form.muted}>Checks that every photo’s original is still in storage and unchanged.</p>
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
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </SettingsSection>
    </>
  );
}
