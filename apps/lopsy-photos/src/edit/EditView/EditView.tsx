import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, Download, FlipHorizontal2, Redo2, RotateCcw, RotateCw, SplitSquareHorizontal, Undo2 } from 'lucide-react';
import { recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, Json, Version } from '@lopsy/photos-core/library/types';
import { ControlGroup } from '../ControlGroup/ControlGroup';
import {
  GROUPS,
  applyChanges,
  beforeRecipe,
  changeLabel,
  flipRecipe,
  rotateRecipe,
  groupResetChanges,
  sliderChanges,
  type ControlDef,
  type GroupDef,
} from '../edit-controls';
import { isPreviewStale, isTypingTarget, shortcutFor } from '../edit-keys';
import type { DevelopEngine } from '../../engine/develop-engine';
import { LoadStatus } from '../LoadStatus/LoadStatus';
import { usePhotoEngine } from './use-photo-engine';
import styles from './EditView.module.css';

export interface EditViewProps {
  readonly asset: Asset;
  readonly version: Version;
  readonly loadOriginal: (asset: Asset) => Promise<Blob>;
  /** One history step: recipe values by dotted path ('tone.exposure'). */
  readonly onEdit: (changes: Readonly<Record<string, Json>>, label: string) => void;
  readonly onSetRecipe: (recipe: Recipe, label: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClose: () => void;
  /** 512 px and 2048 px JPEGs of the edit, after edits settle and on leaving. */
  readonly onPreviewRendered?: (previews: { thumb: Blob; screen: Blob; recipeHash: string }) => void;
  readonly onExport?: (blob: Blob, fileName: string) => void;
}

/** How long the edit must stay unchanged before previews are rendered. */
const SETTLE_MS = 1200;
const THUMB_SIZE = 512;
const SCREEN_SIZE = 2048;
const WHEEL_ZOOM_SPEED = 0.0015;

interface Committed {
  /** The version recipe the changes were made on; they apply until it changes. */
  readonly base: Recipe;
  readonly changes: Readonly<Record<string, Json>>;
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

async function renderPreviews(engine: DevelopEngine, recipe: Recipe) {
  engine.setRecipe(recipe);
  const thumb = await engine.renderPreview(THUMB_SIZE);
  const screen = await engine.renderPreview(SCREEN_SIZE);
  return { thumb, screen, recipeHash: recipeHash(recipe) };
}

export function EditView({
  asset,
  version,
  loadOriginal,
  onEdit,
  onSetRecipe,
  onUndo,
  onRedo,
  onClose,
  onPreviewRendered,
  onExport,
}: EditViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { engine, status, view } = usePhotoEngine(canvasRef, asset, loadOriginal);
  const [draft, setDraft] = useState<Readonly<Record<string, Json>> | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [isBeforeToggled, setIsBeforeToggled] = useState(false);
  const [isBeforeHeld, setIsBeforeHeld] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const isReady = status.kind === 'ready';
  const isBefore = isBeforeToggled || isBeforeHeld;

  const savedRecipe = committed?.base === version.recipe ? applyChanges(version.recipe, committed.changes) : version.recipe;
  const shownRecipe = useMemo(() => (draft ? applyChanges(savedRecipe, draft) : savedRecipe), [savedRecipe, draft]);

  // A committed edit only bridges the moment until the library hands back
  // the new recipe; once it has, an undo back to the old recipe object must
  // not bring the edit back.
  useEffect(() => {
    setCommitted(null);
  }, [version.recipe]);

  useEffect(() => {
    engine?.setRecipe(isBefore ? beforeRecipe(shownRecipe) : shownRecipe);
  }, [engine, shownRecipe, isBefore]);

  // ---- previews ------------------------------------------------------

  const previewed = useRef<{ thumbHash: string | null; screenHash: string | null }>({
    thumbHash: version.thumb?.recipeHash ?? null,
    screenHash: version.screen?.recipeHash ?? null,
  });
  const onPreviewRenderedRef = useRef(onPreviewRendered);
  onPreviewRenderedRef.current = onPreviewRendered;
  const previewJob = useRef<Promise<void> | null>(null);

  const refreshPreviews = useCallback(
    (recipe: Recipe): Promise<void> => {
      const callback = onPreviewRenderedRef.current;
      const hash = recipeHash(recipe);
      if (!engine || !callback || !isPreviewStale(previewed.current, hash)) return Promise.resolve();
      const run = async () => {
        try {
          const previews = await renderPreviews(engine, recipe);
          previewed.current = { thumbHash: previews.recipeHash, screenHash: previews.recipeHash };
          callback(previews);
        } catch (err) {
          console.warn('Lopsy Photos: previews could not be rendered', err);
        }
      };
      const job = (previewJob.current ?? Promise.resolve()).then(run);
      previewJob.current = job;
      return job;
    },
    [engine],
  );

  useEffect(() => {
    if (!isReady || draft || isBefore) return;
    const timer = setTimeout(() => void refreshPreviews(savedRecipe), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isReady, draft, isBefore, savedRecipe, refreshPreviews]);

  const handleClose = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      if (isReady) await refreshPreviews(savedRecipe);
    } finally {
      setIsBusy(false);
      onClose();
    }
  }, [isBusy, isReady, refreshPreviews, savedRecipe, onClose]);

  // ---- editing -------------------------------------------------------

  const commit = useCallback(
    (changes: Readonly<Record<string, Json>>, label: string) => {
      setDraft(null);
      if (Object.keys(changes).length === 0) return;
      setCommitted({ base: version.recipe, changes: { ...(committed?.base === version.recipe ? committed.changes : {}), ...changes } });
      onEdit(changes, label);
    },
    [version.recipe, committed, onEdit],
  );

  const handleSliderChange = useCallback((control: ControlDef, value: number) => {
    setDraft(sliderChanges(control.path, value));
  }, []);

  const handleSliderCommit = useCallback(
    (control: ControlDef, value: number) => commit(sliderChanges(control.path, value), changeLabel(control.label, control.path, value)),
    [commit],
  );

  const handleGroupReset = useCallback(
    (group: GroupDef) => commit(groupResetChanges(savedRecipe, group), `Reset ${group.title}`),
    [commit, savedRecipe],
  );

  // ---- keyboard ------------------------------------------------------

  const handlers = useRef({ onUndo, onRedo, engine });
  handlers.current = { onUndo, onRedo, engine };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      const h = handlers.current;
      if (shortcut === 'undo') h.onUndo();
      else if (shortcut === 'redo') h.onRedo();
      else if (shortcut === 'fit') h.engine?.fit();
      else if (shortcut === 'actualSize') h.engine?.setZoom(1);
      else setIsBeforeHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') setIsBeforeHeld(false);
    };
    const handleBlur = () => setIsBeforeHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // ---- zoom and pan --------------------------------------------------

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !engine) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        engine.setZoom(engine.getView().zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED * (e.ctrlKey ? 8 : 1)), anchor);
      } else {
        engine.panBy(-e.deltaX, -e.deltaY);
      }
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [engine]);

  const panPointer = useRef<{ id: number; x: number; y: number } | null>(null);

  const handleStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !engine || e.target !== canvasRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const handleStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = panPointer.current;
    if (!p || p.id !== e.pointerId || !engine) return;
    engine.panBy(e.clientX - p.x, e.clientY - p.y);
    panPointer.current = { id: p.id, x: e.clientX, y: e.clientY };
  };

  const handleStagePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (panPointer.current?.id === e.pointerId) panPointer.current = null;
  };

  // ---- export --------------------------------------------------------

  const handleExport = async () => {
    if (!engine || !onExport || isBusy) return;
    setIsBusy(true);
    try {
      engine.setRecipe(savedRecipe);
      const blob = await engine.exportImage({ format: 'jpeg', quality: 0.92 });
      onExport(blob, `${baseName(asset.fileName)}.jpg`);
    } catch (err) {
      console.error('Lopsy Photos: export failed', err);
    } finally {
      engine.setRecipe(isBefore ? beforeRecipe(shownRecipe) : shownRecipe);
      setIsBusy(false);
    }
  };

  const isAllDefault = recipeHash(beforeRecipe(savedRecipe)) === recipeHash(savedRecipe);
  const zoomPercent = view ? Math.round(view.zoom * 100) : 100;

  return (
    <div className={styles.editView} data-testid="edit-view" data-status={status.kind}>
      <header className={styles.toolbar}>
        <button type="button" className={styles.toolButton} onClick={() => void handleClose()} disabled={isBusy}>
          <ArrowLeft size={16} aria-hidden />
          <span>Library</span>
        </button>
        <span className={styles.fileName} title={asset.fileName}>
          {asset.fileName}
        </span>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.iconButton} aria-label="Undo" title="Undo (⌘Z)" onClick={onUndo}>
            <Undo2 size={16} aria-hidden />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Redo" title="Redo (⇧⌘Z)" onClick={onRedo}>
            <Redo2 size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate left"
            title="Rotate left"
            disabled={!isReady || isBefore}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, false), 'Rotate left')}
          >
            <RotateCcw size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate right"
            title="Rotate right"
            disabled={!isReady || isBefore}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, true), 'Rotate right')}
          >
            <RotateCw size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Flip"
            title="Flip left to right"
            disabled={!isReady || isBefore}
            onClick={() => onSetRecipe(flipRecipe(savedRecipe), 'Flip')}
          >
            <FlipHorizontal2 size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={isBeforeToggled}
            title="Before and after (hold \)"
            onClick={() => setIsBeforeToggled((v) => !v)}
            disabled={!isReady}
          >
            <SplitSquareHorizontal size={16} aria-hidden />
            <span>Before</span>
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={view?.isFit ?? true}
            onClick={() => engine?.fit()}
            disabled={!isReady}
          >
            Fit
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={!view?.isFit && zoomPercent === 100}
            onClick={() => engine?.setZoom(1)}
            disabled={!isReady}
          >
            100%
          </button>
          <span className={styles.zoomReadout} data-testid="zoom-readout">
            {zoomPercent}%
          </span>
        </div>
        {onExport && (
          <button type="button" className={styles.primaryButton} onClick={() => void handleExport()} disabled={!isReady || isBusy}>
            <Download size={16} aria-hidden />
            <span>Export</span>
          </button>
        )}
      </header>
      <div className={styles.body}>
        <div
          ref={stageRef}
          className={styles.stage}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
          <canvas ref={canvasRef} className={styles.canvas} data-testid="edit-canvas" />
          {isBefore && isReady && <span className={styles.beforeBadge}>Before</span>}
          <LoadStatus status={status} onClose={onClose} />
        </div>
        <aside className={styles.panel} aria-label="Edits">
          {GROUPS.map((group) => (
            <ControlGroup
              key={group.id}
              group={group}
              recipe={shownRecipe}
              isDisabled={!isReady || isBefore}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
              onReset={handleGroupReset}
            />
          ))}
          <div className={styles.panelFooter}>
            <button
              type="button"
              className={styles.toolButton}
              disabled={!isReady || isBefore || isAllDefault}
              onClick={() => onSetRecipe(beforeRecipe(savedRecipe), 'Reset all edits')}
            >
              Reset all
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
