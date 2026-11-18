import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, Json, PreviewRef } from '@lopsy/photos-core/library/types';
import { EditView } from '../EditView/EditView';
import { applyChanges } from '../edit-controls';
import { formatOf, harnessAsset, harnessVersion } from './harness-asset';
import { pushStep, redoStep, startHistory, undoStep, type RecipeHistory } from './recipe-history';
import styles from './EditHarness.module.css';

/** What the harness records, for e2e tests and for poking at in the console. */
export interface HarnessRecord {
  readonly previews: { readonly recipeHash: string; readonly thumb: Blob; readonly screen: Blob }[];
  readonly exports: { readonly blob: Blob; readonly fileName: string }[];
  readonly steps: string[];
  recipe: Recipe | null;
}

declare global {
  interface Window {
    __photosHarness?: HarnessRecord;
  }
}

interface Opened {
  readonly file: File;
  readonly asset: Asset;
}

function previewRef(hash: string, blob: Blob): PreviewRef {
  return { fileId: `preview-${hash}-${blob.size}`, recipeHash: hash, width: 0, height: 0 };
}

/**
 * A page for developing the Edit view on its own: pick or drop a file and
 * edit it with an in-memory recipe and history, no library.
 */
export function EditHarness() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [history, setHistory] = useState<RecipeHistory | null>(null);
  const [previews, setPreviews] = useState<{ thumb: PreviewRef | null; screen: PreviewRef | null }>({ thumb: null, screen: null });
  const [message, setMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const counter = useRef(0);
  const record = useMemo<HarnessRecord>(() => ({ previews: [], exports: [], steps: [], recipe: null }), []);

  useEffect(() => {
    window.__photosHarness = record;
  }, [record]);

  useEffect(() => {
    record.recipe = history?.present ?? null;
  }, [history, record]);

  const open = useCallback((file: File) => {
    const format = formatOf(file.name, file.type);
    if (!format || format === 'lopsy') {
      setMessage(`${file.name} is not a photo the Edit view can open.`);
      return;
    }
    counter.current += 1;
    const asset = harnessAsset(`harness-${counter.current}`, file.name, file.size, format, file.type);
    setMessage(null);
    setOpened({ file, asset });
    setHistory(startHistory(harnessVersion(asset).recipe));
    setPreviews({ thumb: null, screen: null });
  }, []);

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file) open(file);
    e.currentTarget.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) open(file);
  };

  const step = useCallback(
    (recipe: Recipe, label: string) => {
      record.steps.push(label);
      setHistory((h) => (h ? pushStep(h, recipe, label) : h));
    },
    [record],
  );

  const handleEdit = useCallback(
    (changes: Readonly<Record<string, Json>>, label: string) => {
      if (history) step(applyChanges(history.present, changes), label);
    },
    [history, step],
  );

  const loadOriginal = useCallback(async (asset: Asset): Promise<Blob> => {
    if (!opened || opened.asset.id !== asset.id) throw new Error('That file is no longer open');
    return opened.file;
  }, [opened]);

  const version = useMemo(
    () => (opened && history ? harnessVersion(opened.asset, history.present, previews) : null),
    [opened, history, previews],
  );

  const picker = (
    <label className={styles.pick}>
      <input type="file" className={styles.fileInput} data-testid="harness-file" onChange={handleInput} accept=".raf,.dng,.jpg,.jpeg,.png,.webp" />
      <span>Open a photo</span>
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
      {opened && version ? (
        <EditView
          key={opened.asset.id}
          asset={opened.asset}
          version={version}
          loadOriginal={loadOriginal}
          onEdit={handleEdit}
          onSetRecipe={step}
          onUndo={() => setHistory((h) => (h ? undoStep(h) : h))}
          onRedo={() => setHistory((h) => (h ? redoStep(h) : h))}
          onClose={() => {
            setOpened(null);
            setHistory(null);
          }}
          onPreviewRendered={(p) => {
            record.previews.push(p);
            setPreviews({ thumb: previewRef(p.recipeHash, p.thumb), screen: previewRef(p.recipeHash, p.screen) });
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
        />
      ) : (
        <div className={styles.empty}>
          <h1 className={styles.title}>Edit view harness</h1>
          <p className={styles.hint}>Drop a RAF, DNG, JPEG, PNG or WebP file here, or</p>
          {picker}
          {message && <p className={styles.message}>{message}</p>}
        </div>
      )}
    </div>
  );
}
