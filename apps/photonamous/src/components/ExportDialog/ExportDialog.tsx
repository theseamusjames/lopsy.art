import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ExportPreset, VersionId } from '@lopsy/photos-core/library/types';
import {
  DEFAULT_EXPORT_SETTINGS,
  exportSettingsProblem,
  isHdrFormat,
  usesQuality,
  type ExportColorSpace,
  type ExportFormat,
  type ExportSettings,
} from '@lopsy/photos-core/export/types';
import { expandTemplate, extensionFor, sanitizeFileName } from '@lopsy/photos-core/export/file-names';
import { getBackend } from '../../app/backend-registry';
import { useExportPresets, useExportProgress, useLibraryView, useSession } from '../../app/hooks';
import { tiffExportAvailable } from '../../app/export-capabilities';
import {
  COLOR_SPACE_WORDS,
  HDR_FORMATS,
  deviceSizeNote,
  HDR_FORMAT_WORDS,
  fitExportChoices,
  fixedColorWords,
  hdrUnavailableReason,
  locationKept,
  offeredColorSpaces,
  sizeChoicesFor,
} from '../../library/export-form';
import { currentStatus, onStatusChange } from '../../engine/engine-status';
import { textureLimit } from '../../engine/texture-limit';
import {
  DEFAULT_EXTRAS,
  extrasSettingKey,
  presetExtras,
  withExtras,
  type ExportExtras,
  type SizeSpec,
} from '../../library/export-size';
import { ExportPresetBar } from '../ExportPresetBar/ExportPresetBar';
import { useUi } from '../../app/store';
import { exportVersions } from '../../app/commands';
import { plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import { focusedElement } from '@lopsy/ui/a11y/focus-trap';
import styles from './ExportDialog.module.css';

const TOKENS = ['{name}', '{date}', '{seq}', '{seq:3}', '{title}', '{version}', '{camera}'];
const SIZE_MODES: ReadonlyArray<{ readonly value: SizeSpec['mode']; readonly label: string }> = [
  { value: 'original', label: 'Original size' },
  { value: 'long', label: 'Long edge' },
  { value: 'short', label: 'Short edge' },
  { value: 'megapixels', label: 'Megapixels' },
];

function defaultName(): string {
  const d = new Date();
  return `Export ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sizeValue(size: SizeSpec): number {
  return size.mode === 'megapixels' ? size.mp : size.mode === 'original' ? 0 : size.px;
}

/**
 * Spec 5.5: format, size, metadata, file names and where it goes, from a
 * preset or by hand. Every field has a visible label; why Export is off is
 * said in words (and read with the button); the export's start and end are
 * announced, its failures as an alert.
 */
export function ExportDialog() {
  const session = useSession();
  const view = useLibraryView();
  const openDialog = useUi((s) => s.openDialog);
  const job = useUi((s) => s.exportJob);
  const setExportJob = useUi((s) => s.setExportJob);
  const progress = useExportProgress(job);
  const [versionIds] = useState<VersionId[]>(exportVersions);
  const presets = useExportPresets();
  const [presetId, setPresetId] = useState<string | null>(null);
  const [state, setState] = useState(() => fitExportChoices({ ...DEFAULT_EXPORT_SETTINGS, colorSpace: 'srgb' }, DEFAULT_EXTRAS));
  const { settings, extras } = state;
  const [tiff, setTiff] = useState(false);
  const engineStatus = useSyncExternalStore(onStatusChange, currentStatus);
  const hdrUnavailable = hdrUnavailableReason(engineStatus.isEightBit);
  const [destination, setDestination] = useState<'library' | 'download'>('library');
  const [name, setName] = useState(defaultName);
  const running = progress !== null && !progress.finished;
  const format = settings.format;
  const id = useId();
  const doneRef = useRef<HTMLButtonElement>(null);

  const change = (patch: Partial<ExportSettings>, extrasPatch: Partial<ExportExtras> = {}) => {
    setState((s) => fitExportChoices({ ...s.settings, ...patch }, { ...s.extras, ...extrasPatch }));
    setPresetId(null);
  };
  const setSize = (size: SizeSpec) => change({}, { size });

  const pickPreset = (preset: ExportPreset) => {
    // A preset saved before the size fields existed kept them in a setting.
    const ex = presetExtras(preset.settings, view.settings.get(extrasSettingKey(preset.id)));
    setState(fitExportChoices(preset.settings, ex));
    setPresetId(preset.id);
  };

  // With the size and depth, which decide whether Rec. 2020 can be written.
  const problem = exportSettingsProblem(withExtras(settings, extras));
  const keepsLocation = locationKept(settings);
  const tiffBlocked = format === 'tiff' && !tiff;
  const hdrBlocked = isHdrFormat(format) && hdrUnavailable !== null;
  const fixedColors = fixedColorWords(format);
  const sizeChoices = sizeChoicesFor(format, extras.size.mode);
  // The photos' own sizes, for what this device can export of them (full-size.ts).
  const ownSizes = useMemo(
    () =>
      versionIds.map((versionId) => {
        const version = view.versions.get(versionId);
        const asset = version ? view.assets.get(version.assetId) : undefined;
        return asset?.width && asset.height ? { width: asset.width, height: asset.height } : null;
      }),
    [versionIds, view],
  );
  // Where the engine renders in floating point it exports a photo larger than its textures in tiles.
  const deviceNote = deviceSizeNote(ownSizes, textureLimit(), format, extras, !engineStatus.isEightBit);
  const isBlocked = running || versionIds.length === 0 || problem !== null || tiffBlocked || hdrBlocked;
  const finished = progress?.finished ?? false;

  // Export goes from the footer when it finishes, with focus on it; Done takes its place.
  useEffect(() => {
    if (finished && focusedElement() === null) doneRef.current?.focus();
  }, [finished]);
  // Said once at the start and once at the end, not for every photo; worded apart from the progress line on screen.
  const spoken =
    progress === null
      ? ''
      : progress.finished
        ? `Export finished: ${plural(progress.done - progress.failures.length, 'photo')} exported${progress.failures.length > 0 ? `, ${progress.failures.length} failed` : ''}.`
        : `Export started: ${plural(progress.total, 'photo')}.`;

  // What the first file will be called.
  const sampleName = useMemo(() => {
    const version = versionIds[0] !== undefined ? view.versions.get(versionIds[0]) : undefined;
    const asset = version ? view.assets.get(version.assetId) : undefined;
    if (!version || !asset) return null;
    return sanitizeFileName(expandTemplate(settings.fileNameTemplate || '{name}', { asset, version, seq: 1 })) + extensionFor(format);
  }, [versionIds, view, settings.fileNameTemplate, format]);

  useEffect(() => {
    let live = true;
    void tiffExportAvailable().then((ok) => {
      if (live) setTiff(ok);
    });
    return () => {
      live = false;
    };
  }, []);

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
        colorSpace: settings.colorSpace ?? 'srgb',
        base: { ...settings, fileNameTemplate: settings.fileNameTemplate.trim() || '{name}' },
        quality: Math.round(settings.quality * 100),
        longEdge: settings.maxLongEdge,
        extras,
        destination,
        name: name.trim() || defaultName(),
      }),
    );
  };

  const qualitySlider = (
    <label className={styles.range}>
      <span>Quality</span>
      <input
        type="range"
        min={40}
        max={100}
        aria-label="Quality"
        value={Math.round(settings.quality * 100)}
        onChange={(e) => change({ quality: Number(e.target.value) / 100 })}
      />
      <span className={styles.value}>{Math.round(settings.quality * 100)}</span>
    </label>
  );

  return (
    <Modal
      title={`Export ${plural(versionIds.length, 'photo')}`}
      width="lg"
      onClose={close}
      footer={
        progress?.finished ? (
          <Button ref={doneRef} variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>{running ? 'Keep going in the background' : 'Cancel'}</Button>
            <Button
              variant="primary"
              aria-disabled={isBlocked || undefined}
              aria-describedby={
                [tiffBlocked ? `${id}-tiff` : '', hdrBlocked ? `${id}-hdr` : '', problem ? `${id}-problem` : ''].filter(Boolean).join(' ') || undefined
              }
              onClick={start}
            >
              Export
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <p className={styles.srOnly} role="status">
          {spoken}
        </p>
        <div className={styles.columns}>
          <div className={styles.column}>
            <div className={styles.field}>
              <label className={styles.legend} htmlFor={`${id}-preset`}>
                Preset
              </label>
          <ExportPresetBar
            id={`${id}-preset`}
            presets={presets}
            selectedId={presetId}
            disabled={running}
            onPick={pickPreset}
            onSave={(presetName) => {
              const id = session.saveExportPreset(presetName, withExtras(settings, extras));
              if (!id) return;
              setPresetId(id);
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
            <input type="radio" name="format" checked={format === 'jpeg'} onChange={() => change({ format: 'jpeg' as ExportFormat })} />
            JPEG <span className={styles.muted}>— small files, for sharing</span>
          </label>
          {format === 'jpeg' && qualitySlider}
          <label className={styles.option}>
            <input type="radio" name="format" checked={format === 'png'} onChange={() => change({ format: 'png' })} />
            PNG <span className={styles.muted}>— no compression loss, larger files</span>
          </label>
          {format === 'png' && (
            <div className={styles.inline} role="radiogroup" aria-label="PNG bit depth">
              <label className={styles.option}>
                <input type="radio" name="depth" checked={extras.pngDepth === 16} onChange={() => change({}, { pngDepth: 16 })} />
                16-bit
              </label>
              <label className={styles.option}>
                <input type="radio" name="depth" checked={extras.pngDepth === 8} onChange={() => change({}, { pngDepth: 8 })} />
                8-bit <span className={styles.muted}>— smaller</span>
              </label>
            </div>
          )}
          {(tiff || format === 'tiff') && (
            <label className={styles.option}>
              <input type="radio" name="format" checked={format === 'tiff'} onChange={() => change({ format: 'tiff' })} />
              TIFF, 16-bit <span className={styles.muted}>— for printing and further editing</span>
            </label>
          )}
          <p className={styles.subhead} id={`${id}-hdr-head`}>
            HDR, highlights brighter than white
          </p>
          {hdrUnavailable !== null ? (
            <p className={styles.muted} id={`${id}-hdr`}>
              {hdrUnavailable}
            </p>
          ) : (
            HDR_FORMATS.map((hdrFormat) => (
              <div key={hdrFormat} className={styles.hdrOption}>
                <label className={styles.option}>
                  <input
                    type="radio"
                    name="format"
                    checked={format === hdrFormat}
                    aria-describedby={`${id}-${hdrFormat}-help`}
                    onChange={() => change({ format: hdrFormat })}
                  />
                  {HDR_FORMAT_WORDS[hdrFormat].label}
                </label>
                <p className={`${styles.muted} ${styles.indent}`} id={`${id}-${hdrFormat}-help`}>
                  {HDR_FORMAT_WORDS[hdrFormat].help}
                </p>
                {format === hdrFormat && usesQuality(hdrFormat) && qualitySlider}
              </div>
            ))
          )}
          {tiffBlocked && (
            <p className={styles.warn} id={`${id}-tiff`} role="alert">
              This build cannot write TIFF yet. Choose JPEG or PNG.
            </p>
          )}
          {problem && (
            <p className={styles.warn} id={`${id}-problem`} role="alert">
              {problem}
            </p>
          )}
        </fieldset>

        {fixedColors !== null ? (
          <div className={styles.field}>
            <span className={styles.legend}>Colours</span>
            <span>{fixedColors}</span>
          </div>
        ) : (
        <label className={styles.field}>
          <span className={styles.legend}>Colours</span>
          <select
            className={styles.select}
            disabled={running}
            aria-label="Colours"
            value={settings.colorSpace ?? 'srgb'}
            onChange={(e) => change({ colorSpace: e.target.value as ExportColorSpace })}
          >
            {offeredColorSpaces(format, extras.pngDepth).map((space) => (
              <option key={space} value={space}>
                {COLOR_SPACE_WORDS[space]}
              </option>
            ))}
          </select>
        </label>
        )}

        <div className={styles.field}>
          <label className={styles.legend} htmlFor={`${id}-size`}>
            Size
          </label>
          <div className={styles.inline}>
            <select
              id={`${id}-size`}
              className={styles.select}
              aria-describedby={deviceNote !== null ? `${id}-device-size` : undefined}
              disabled={running || !sizeChoices.canChoose}
              value={extras.size.mode}
              onChange={(e) => {
                const mode = e.target.value as SizeSpec['mode'];
                if (mode === 'original') setSize({ mode });
                else if (mode === 'megapixels') setSize({ mode, mp: 12 });
                else setSize({ mode, px: mode === 'long' ? 2048 : 1080 });
              }}
            >
              {SIZE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {extras.size.mode !== 'original' && (
              <>
                <input
                  className={styles.number}
                  type="number"
                  min={extras.size.mode === 'megapixels' ? 0.1 : 16}
                  step={extras.size.mode === 'megapixels' ? 0.1 : 1}
                  aria-label={extras.size.mode === 'megapixels' ? 'Megapixels (MP)' : 'Pixels (px)'}
                  disabled={running}
                  value={sizeValue(extras.size)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!(n > 0)) return;
                    const size = extras.size;
                    if (size.mode === 'megapixels') setSize({ mode: 'megapixels', mp: n });
                    else if (size.mode !== 'original') setSize({ mode: size.mode, px: Math.round(n) });
                  }}
                />
                <span className={styles.muted}>{extras.size.mode === 'megapixels' ? 'MP' : 'px'}</span>
              </>
            )}
          </div>
          {sizeChoices.offersEnlarge && (
            <label className={styles.option}>
              <input type="checkbox" checked={!extras.allowEnlarge} disabled={running} onChange={(e) => change({}, { allowEnlarge: !e.target.checked })} />
              Don’t enlarge <span className={styles.muted}>— smaller photos stay as they are</span>
            </label>
          )}
          {sizeChoices.note !== null && <span className={styles.muted}>{sizeChoices.note}</span>}
          {deviceNote !== null && (
            <span className={styles.muted} id={`${id}-device-size`} data-testid="export-device-size">
              {deviceNote}
            </span>
          )}
        </div>

          </div>
          <div className={styles.column}>
        <fieldset className={styles.group} disabled={running || format === 'tiff'}>
          <legend className={styles.legend}>
            Details in the file{format === 'tiff' && <span className={styles.muted}> — TIFF keeps none</span>}
          </legend>
          <label className={styles.option}>
            <input type="radio" name="metadata" checked={settings.metadata === 'all'} onChange={() => change({ metadata: 'all' })} />
            All <span className={styles.muted}>— camera, exposure, date, copyright</span>
          </label>
          <label className={styles.option}>
            <input type="radio" name="metadata" checked={settings.metadata === 'copyright'} onChange={() => change({ metadata: 'copyright' })} />
            Copyright and contact only
          </label>
          <label className={styles.option}>
            <input type="radio" name="metadata" checked={settings.metadata === 'none'} onChange={() => change({ metadata: 'none' })} />
            None
          </label>
          {settings.metadata === 'all' && (
            <label className={styles.option}>
              <input type="checkbox" checked={settings.removeLocation} onChange={(e) => change({ removeLocation: e.target.checked })} />
              Remove location
            </label>
          )}
          {keepsLocation && (
            <p className={styles.warn} role="alert">
              Location will be kept: these settings leave where each photo was taken in the exported files.
            </p>
          )}
          {settings.metadata !== 'none' && (
            <div className={styles.inline}>
              <label className={styles.labelled}>
                <span className={styles.legend}>Creator</span>
                <input className={styles.text} value={settings.creator ?? ''} onChange={(e) => change({ creator: e.target.value })} />
              </label>
              <label className={styles.labelled}>
                <span className={styles.legend}>Copyright</span>
                <input
                  className={styles.text}
                  placeholder="© 2026 Your name"
                  value={settings.copyright ?? ''}
                  onChange={(e) => change({ copyright: e.target.value })}
                />
              </label>
            </div>
          )}
        </fieldset>

        <div className={styles.field}>
          <label className={styles.legend} htmlFor={`${id}-names`}>
            File names
          </label>
          <input
            id={`${id}-names`}
            className={styles.text}
            aria-describedby={`${id}-tokens`}
            disabled={running}
            value={settings.fileNameTemplate}
            onChange={(e) => change({ fileNameTemplate: e.target.value })}
          />
          <span className={styles.muted} id={`${id}-tokens`}>
            {TOKENS.join(' ')}
            {sampleName && ` · ${sampleName}`}
          </span>
        </div>

        <fieldset className={styles.group} disabled={running}>
          <legend className={styles.legend}>Save to</legend>
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'library'} onChange={() => setDestination('library')} />
            The Exports folder in {where}
          </label>
          {destination === 'library' && (
            <label className={styles.named}>
              <span className={styles.legend}>Folder name</span>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'download'} onChange={() => setDestination('download')} />
            Download to this computer
          </label>
          {destination === 'download' && versionIds.length > 1 && (
            <label className={`${styles.option} ${styles.indent}`}>
              <input type="checkbox" checked={extras.zip} onChange={(e) => change({}, { zip: e.target.checked })} />
              As one zip
            </label>
          )}
          {destination === 'download' && versionIds.length > 1 && extras.zip && (
            <label className={styles.named}>
              <span className={styles.legend}>Zip name</span>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
        </fieldset>
        <p className={styles.muted}>Output sharpening for screen or print is not available yet.</p>
          </div>
        </div>

        {progress && (
          <div className={styles.progress}>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.finished ? progress.total : progress.done}
            >
              {/* Done photos fill the bar; while one renders (a full-size RAW can take a while) a stripe moves in the rest. */}
              <span
                className={styles.fill}
                data-finished={progress.finished}
                style={{ '--fraction': `${progress.finished || progress.total === 0 ? 100 : (progress.done / progress.total) * 100}%` } as React.CSSProperties}
              />
              {!progress.finished && <span className={styles.working} />}
            </div>
            <p className={styles.muted}>
              {progress.finished
                ? `Exported ${plural(progress.done - progress.failures.length, 'photo')}.`
                : `Exporting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`}
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
