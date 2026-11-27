import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, Json, Preset, PreviewRef, Version } from '@lopsy/photos-core/library/types';
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '@lopsy/photos-core/export/types';
import { createEngineExportRenderer, type EngineRenderer } from '../../engine/export-renderer';
import { EditView } from '../EditView/EditView';
import type { FilmstripItem } from '../Filmstrip/Filmstrip';
import { applyChanges } from '../edit-controls';
import { PIPELINE_VERSION, pickGroups } from '@lopsy/photos-core/library/recipe';
import { BUILT_IN_PRESETS } from '@lopsy/photos-core/library/presets';
import { formatOf, harnessAsset, harnessVersion } from './harness-asset';
import { historySteps } from './recipe-history';
import { EMPTY_HARNESS, currentPhoto, currentVersion, harnessReducer } from './harness-state';
import styles from './EditHarness.module.css';

/** What the harness records, for e2e tests and for poking at in the console. */
export interface HarnessRecord {
  readonly previews: { readonly recipeHash: string; readonly thumb: Blob; readonly screen: Blob }[];
  readonly exports: { readonly blob: Blob; readonly fileName: string }[];
  readonly steps: string[];
  /** What Edit in Lopsy would hand over: the 16-bit PNGs, in order. */
  readonly lopsyPngs: ArrayBuffer[];
  recipe: Recipe | null;
}

declare global {
  interface Window {
    __photosHarness?: HarnessRecord;
    /**
     * The open photo exported through the harness's export renderer (the
     * app's export path, on an engine of its own) with `settings` and
     * `recipe` (the version's when omitted), for e2e tests of every format.
     * `abort`, when given, is checked by the export like a cancel button.
     */
    __photosHarnessExport?: (settings: Partial<ExportSettings>, recipe?: Recipe, abort?: { aborted: boolean }) => Promise<Blob>;
    /** The notes the harness's export renderer gave (`onNote`), in order. */
    __photosHarnessNotes?: string[];
  }
}

function previewRef(hash: string, blob: Blob): PreviewRef {
  return { fileId: `preview-${hash}-${blob.size}`, recipeHash: hash, pipeline: PIPELINE_VERSION, width: 0, height: 0 };
}

const OPENABLE = /\.(raf|dng|arw|jpe?g|png|webp)$/i;

/**
 * A page for developing the Edit view on its own: pick or drop files and
 * edit them with in-memory versions and histories, no library. Several
 * files make a filmstrip.
 */
export function EditHarness() {
  const [state, dispatch] = useReducer(harnessReducer, EMPTY_HARNESS);
  const [files, setFiles] = useState<ReadonlyMap<string, File>>(new Map());
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [copied, setCopied] = useState<Readonly<Record<string, Json>> | null>(null);
  const [userPresets, setUserPresets] = useState<readonly Preset[]>([]);
  const presets = useMemo(() => [...BUILT_IN_PRESETS, ...userPresets], [userPresets]);
  const counter = useRef(0);
  const record = useMemo<HarnessRecord>(() => ({ previews: [], exports: [], steps: [], lopsyPngs: [], recipe: null }), []);
  const photo = currentPhoto(state);
  const current = currentVersion(state);
  const filesRef = useRef(files);
  filesRef.current = files;
  // `__photosHarnessExport` renders as the app's Export does: on an export renderer's engine, which makes a photo
  // larger than the GPU in tiles. The Export button stays the Edit view's own engine's, which never makes tiles.
  const exportRenderer = useRef<EngineRenderer | null>(null);
  useEffect(() => {
    const notes: string[] = [];
    window.__photosHarnessNotes = notes;
    const renderer = createEngineExportRenderer({
      loadOriginal: async (asset) => {
        const file = filesRef.current.get(asset.id);
        if (!file) throw new Error('That file is no longer open');
        return file;
      },
      onNote: (note) => notes.push(note),
    });
    exportRenderer.current = renderer;
    return () => {
      renderer.dispose();
      if (exportRenderer.current === renderer) exportRenderer.current = null;
    };
  }, []);

  useEffect(() => {
    window.__photosHarness = record;
  }, [record]);

  useEffect(() => {
    record.recipe = current?.history.present ?? null;
  }, [current, record]);

  const shownAsset = photo?.asset ?? null;
  const shownRecipe = current?.history.present ?? null;
  const renderExport = useCallback(
    (settings: Partial<ExportSettings>, recipe?: Recipe, abort?: { aborted: boolean }): Promise<Blob> => {
      const renderer = exportRenderer.current;
      if (!shownAsset || !shownRecipe || !renderer) return Promise.reject(new Error('No photo is open'));
      const controller = new AbortController();
      const watch = abort ? setInterval(() => abort.aborted && controller.abort(), 50) : null;
      return renderer
        .render(shownAsset, harnessVersion(shownAsset, recipe ?? shownRecipe), { ...DEFAULT_EXPORT_SETTINGS, ...settings }, controller.signal)
        .finally(() => {
          if (watch) clearInterval(watch);
        });
    },
    [shownAsset, shownRecipe],
  );
  useEffect(() => {
    window.__photosHarnessExport = renderExport;
  }, [renderExport]);

  useEffect(() => () => thumbnails.forEach((url) => URL.revokeObjectURL(url)), [thumbnails]);

  const open = useCallback((list: readonly File[]) => {
    const chosen = list.filter((f) => OPENABLE.test(f.name) || formatOf(f.name, f.type));
    const assets: Asset[] = [];
    const byId = new Map<string, File>();
    const thumbs = new Map<string, string>();
    for (const file of chosen) {
      const format = formatOf(file.name, file.type);
      if (!format || format === 'lopsy') continue;
      counter.current += 1;
      const asset = harnessAsset(`harness-${counter.current}`, file.name, file.size, format, file.type);
      assets.push(asset);
      byId.set(asset.id, file);
      if (format === 'jpeg' || format === 'png' || format === 'webp') thumbs.set(asset.id, URL.createObjectURL(file));
    }
    if (assets.length === 0) {
      setMessage(`${list[0]?.name ?? 'That file'} is not a photo the Edit view can open.`);
      return;
    }
    setMessage(null);
    setFiles(byId);
    setThumbnails(thumbs);
    dispatch({ kind: 'open', assets, recipe: harnessVersion(assets[0] as Asset).recipe });
  }, []);

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.currentTarget.files ?? []);
    if (list.length > 0) open(list);
    e.currentTarget.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const list = Array.from(e.dataTransfer.files);
    if (list.length > 0) open(list);
  };

  const step = useCallback(
    (recipe: Recipe, label: string) => {
      record.steps.push(label);
      dispatch({ kind: 'step', recipe, label });
    },
    [record],
  );

  const presentRecipe = current?.history.present ?? null;
  const handleEdit = useCallback(
    (changes: Readonly<Record<string, Json>>, label: string) => {
      if (presentRecipe) step(applyChanges(presentRecipe, changes), label);
    },
    [presentRecipe, step],
  );

  const loadOriginal = useCallback(
    async (asset: Asset): Promise<Blob> => {
      const file = files.get(asset.id);
      if (!file) throw new Error('That file is no longer open');
      return file;
    },
    [files],
  );

  const version = useMemo<Version | null>(() => {
    if (!photo || !current) return null;
    return { ...harnessVersion(photo.asset, current.history.present, { thumb: current.thumb, screen: current.screen }), id: current.id, name: current.name };
  }, [photo, current]);

  const versions = useMemo<Version[]>(
    () => (photo ? photo.versions.map((v) => ({ ...harnessVersion(photo.asset, v.history.present), id: v.id, name: v.name })) : []),
    [photo],
  );

  const history = useMemo(() => (current ? historySteps(current.history) : []), [current]);

  const filmstrip = useMemo<FilmstripItem[]>(
    () => state.photos.map((p) => ({ id: p.asset.id, label: p.asset.fileName, thumbnail: thumbnails.get(p.asset.id) ?? null })),
    [state.photos, thumbnails],
  );

  const picker = (
    <label className={styles.pick}>
      <input
        type="file"
        multiple
        className={styles.fileInput}
        data-testid="harness-file"
        onChange={handleInput}
        accept=".raf,.dng,.arw,.jpg,.jpeg,.png,.webp"
      />
      <span>Open photos</span>
    </label>
  );

  return (
    <div
      className={styles.harness}
      data-drag-over={isDragOver || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {photo && version ? (
        <EditView
          asset={photo.asset}
          version={version}
          loadOriginal={loadOriginal}
          onEdit={handleEdit}
          onSetRecipe={step}
          onUndo={() => dispatch({ kind: 'undo' })}
          onRedo={() => dispatch({ kind: 'redo' })}
          onClose={() => dispatch({ kind: 'close' })}
          onPreviewRendered={(p) => {
            record.previews.push(p);
            dispatch({ kind: 'previews', thumb: previewRef(p.recipeHash, p.thumb), screen: previewRef(p.recipeHash, p.screen) });
          }}
          onEditInLopsy={(renderPng16) => {
            renderPng16()
              .then((png) => record.lopsyPngs.push(png))
              .catch((err: unknown) => console.error('Photonamous: Edit in Lopsy render failed', err));
          }}
          onExport={(blob, fileName) => {
            record.exports.push({ blob, fileName });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
          history={history}
          versions={versions}
          onSelectVersion={(versionId) => dispatch({ kind: 'selectVersion', versionId })}
          onCreateVersion={(name, recipe) => {
            record.steps.push(`New version: ${name}`);
            dispatch({ kind: 'createVersion', name, recipe });
          }}
          onRenameVersion={(versionId, name) => dispatch({ kind: 'renameVersion', versionId, name })}
          onDeleteVersion={(versionId) => dispatch({ kind: 'deleteVersion', versionId })}
          onCopyEdits={(edits) => {
            record.steps.push('Copy edits');
            setCopied(edits.values);
          }}
          onPasteEdits={() => {
            if (copied) handleEdit(copied, 'Paste edits');
          }}
          canPasteEdits={copied !== null}
          presets={presets}
          onSavePreset={(name, recipe, groups) => {
            counter.current += 1;
            const preset: Preset = {
              id: `harness-preset-${counter.current}`,
              name,
              groups: [...groups],
              values: pickGroups(recipe, groups),
              createdAt: new Date().toISOString(),
              deleted: false,
            };
            setUserPresets((list) => [...list, preset]);
          }}
          onDeletePreset={(presetId) => setUserPresets((list) => list.filter((p) => p.id !== presetId))}
          filmstrip={filmstrip.length > 1 ? { items: filmstrip, currentId: photo.asset.id, onOpen: (assetId) => dispatch({ kind: 'show', assetId }) } : undefined}
        />
      ) : (
        <main className={styles.empty}>
          <h1 className={styles.title}>Edit view harness</h1>
          <p className={styles.hint}>Drop RAF, DNG, ARW, JPEG, PNG or WebP files here, or</p>
          {picker}
          {message && (
            <p className={styles.message} role="alert">
              {message}
            </p>
          )}
        </main>
      )}
    </div>
  );
}
