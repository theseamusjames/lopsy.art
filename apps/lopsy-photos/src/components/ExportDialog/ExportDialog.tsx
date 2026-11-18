import { useEffect, useMemo, useState } from 'react';
import type { VersionId } from '@lopsy/photos-core/library/types';
import { getBackend } from '../../app/backend-registry';
import type { ExportFormat } from '../../app/backend';
import type { ExportPreset } from '@lopsy/photos-core/library/types';
import { colorSpacesFor, exportSettingsProblem, type ExportColorSpace, type ExportSettings } from '@lopsy/photos-core/export/types';
import { useExportPresets, useExportProgress, useSession } from '../../app/hooks';
import { tiffExportAvailable } from '../../app/export-capabilities';
import { COLOR_SPACE_WORDS, DEFAULT_EXPORT_FORM, fitColorSpace, formFromSettings, settingsFromForm, type ExportForm } from '../../library/export-form';
import { ExportPresetBar } from '../ExportPresetBar/ExportPresetBar';
import { useUi } from '../../app/store';
import { currentVersions } from '../../app/commands';
import { plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './ExportDialog.module.css';

const SIZES: ReadonlyArray<{ readonly value: number | null; readonly label: string }> = [
  { value: null, label: 'Full size' },
  { value: 3840, label: 'Large — 3840 px on the long side' },
  { value: 2048, label: 'For the web — 2048 px' },
  { value: 1080, label: 'Small — 1080 px' },
];

function defaultName(): string {
  const d = new Date();
  return `Export ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Saves edited copies of the selected photos as JPEG, PNG or 16-bit TIFF, from a preset or by hand. */
export function ExportDialog() {
  const session = useSession();
  const openDialog = useUi((s) => s.openDialog);
  const job = useUi((s) => s.exportJob);
  const setExportJob = useUi((s) => s.setExportJob);
  const progress = useExportProgress(job);
  const [versionIds] = useState<VersionId[]>(() =>
    currentVersions().map((v) => v.versionId),
  );
  const presets = useExportPresets();
  const [presetId, setPresetId] = useState<string | null>(null);
  const [base, setBase] = useState<ExportSettings | undefined>(undefined);
  const [form, setForm] = useState<ExportForm>(DEFAULT_EXPORT_FORM);
  const [tiff, setTiff] = useState(false);
  const { format, quality, longEdge, colorSpace } = form;
  const change = (patch: Partial<ExportForm>) => {
    setForm((f) => fitColorSpace({ ...f, ...patch }));
    setPresetId(null);
  };
  const setFormat = (value: ExportFormat) => change({ format: value });
  const setQuality = (value: number) => change({ quality: value });
  const setLongEdge = (value: number | null) => change({ longEdge: value });
  const pickPreset = (preset: ExportPreset) => {
    setForm(fitColorSpace(formFromSettings(preset.settings)));
    setBase(preset.settings);
    setPresetId(preset.id);
  };
  const sizes = longEdge !== null && !SIZES.some((s) => s.value === longEdge) ? [...SIZES, { value: longEdge, label: `${longEdge} px on the long side` }] : SIZES;
  const problem = exportSettingsProblem(settingsFromForm(form, base));
  const tiffBlocked = format === 'tiff' && !tiff;

  useEffect(() => {
    let live = true;
    void tiffExportAvailable().then((ok) => {
      if (live) setTiff(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  const [destination, setDestination] = useState<'library' | 'download'>('library');
  const [name, setName] = useState(defaultName);
  const running = progress !== null && !progress.finished;

  // A finished export from before is not this one; start clean. A running one stays shown.
  useEffect(() => {
    const previous = useUi.getState().exportJob;
    if (previous && previous.getProgress().finished) setExportJob(null);
  }, [setExportJob]);
  const where = useMemo(() => (session.adapter.kind === 'google-drive' ? 'Google Drive' : 'your library'), [session]);

  const close = () => openDialog(null);
  const start = () => {
    setExportJob(
      getBackend().exportVersions(session, {
        versionIds,
        format,
        colorSpace,
        ...(base ? { base } : {}),
        quality,
        longEdge,
        destination,
        name: name.trim() || defaultName(),
      }),
    );
  };

  return (
    <Modal
      title={`Export ${plural(versionIds.length, 'photo')}`}
      onClose={close}
      footer={
        progress?.finished ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>{running ? 'Keep going in the background' : 'Cancel'}</Button>
            <Button variant="primary" disabled={running || versionIds.length === 0 || problem !== null || tiffBlocked} onClick={start}>
              Export
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.legend}>Preset</span>
          <ExportPresetBar
            presets={presets}
            selectedId={presetId}
            disabled={running}
            onPick={pickPreset}
            onSave={(presetName) => {
              const id = session.saveExportPreset(presetName, settingsFromForm(form, base));
              if (id) setPresetId(id);
            }}
            onRename={(id, presetName) => session.renameExportPreset(id, presetName)}
            onDelete={(id) => {
              session.deleteExportPreset(id);
              setPresetId(null);
            }}
          />
        </div>

        <fieldset className={styles.group} disabled={running}>
          <legend className={styles.legend}>File type</legend>
          <label className={styles.option}>
            <input type="radio" name="format" checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} />
            JPEG <span className={styles.muted}>— small files, for sharing</span>
          </label>
          <label className={styles.option}>
            <input type="radio" name="format" checked={format === 'png'} onChange={() => setFormat('png')} />
            PNG <span className={styles.muted}>— no compression loss, larger files</span>
          </label>
          {(tiff || format === 'tiff') && (
            <label className={styles.option}>
              <input type="radio" name="format" checked={format === 'tiff'} onChange={() => setFormat('tiff')} />
              TIFF, 16-bit <span className={styles.muted}>— for printing and further editing</span>
            </label>
          )}
          {tiffBlocked && <p className={styles.warn}>This build cannot write TIFF yet. Choose JPEG or PNG.</p>}
          {format === 'jpeg' && (
            <label className={styles.range}>
              <span>Quality</span>
              <input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              <span className={styles.value}>{quality}</span>
            </label>
          )}
        </fieldset>

        <label className={styles.field}>
          <span className={styles.legend}>Colours</span>
          <select
            className={styles.select}
            disabled={running}
            value={colorSpace}
            onChange={(e) => change({ colorSpace: e.target.value as ExportColorSpace })}
          >
            {colorSpacesFor(format).map((space) => (
              <option key={space} value={space}>
                {COLOR_SPACE_WORDS[space]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.legend}>Size</span>
          <select
            className={styles.select}
            disabled={running}
            value={longEdge ?? ''}
            onChange={(e) => setLongEdge(e.target.value === '' ? null : Number(e.target.value))}
          >
            {sizes.map((s) => (
              <option key={s.label} value={s.value ?? ''}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={styles.muted}>Photos are never made larger than they are.</span>
        </label>

        <fieldset className={styles.group} disabled={running}>
          <legend className={styles.legend}>Save to</legend>
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'library'} onChange={() => setDestination('library')} />
            The Exports folder in {where}
          </label>
          {destination === 'library' && (
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Folder name"
              placeholder="Folder name"
            />
          )}
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'download'} onChange={() => setDestination('download')} />
            Download to this computer
          </label>
        </fieldset>

        {progress && (
          <div className={styles.progress} aria-live="polite">
            <div className={styles.bar}>
              <span
                className={styles.fill}
                style={{ '--fraction': `${progress.total === 0 ? 100 : (progress.done / progress.total) * 100}%` } as React.CSSProperties}
              />
            </div>
            <p className={styles.muted}>
              {progress.finished
                ? `Exported ${plural(progress.done - progress.failures.length, 'photo')}.`
                : `Exporting ${progress.done} of ${progress.total}…`}
              {progress.failures.length > 0 && ` ${progress.failures.length} failed.`}
            </p>
            {progress.failures.length > 0 && (
              <ul className={styles.failures} role="alert">
                {[...new Set(progress.failures.map((f) => f.error))].slice(0, 3).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
