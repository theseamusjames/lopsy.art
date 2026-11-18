import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ClipboardPaste, Copy, Crop, Download, FlipHorizontal2, SquarePen, Redo2, RotateCcw, RotateCw, SplitSquareHorizontal, Undo2 } from 'lucide-react';
import { recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, HistoryStep, Json, Version, VersionId } from '@lopsy/photos-core/library/types';
import { LeftColumn, type LeftColumnSection } from '../LeftColumn/LeftColumn';
import { HistoryPanel } from '../HistoryPanel/HistoryPanel';
import { VersionsPanel } from '../VersionsPanel/VersionsPanel';
import { movesTo } from '../history-nav';
import { Filmstrip, type FilmstripItem } from '../Filmstrip/Filmstrip';
import { ControlGroup } from '../ControlGroup/ControlGroup';
import { CurvesGroup } from '../CurvesGroup/CurvesGroup';
import { TabbedGroup } from '../TabbedGroup/TabbedGroup';
import {
  COLOR_BY_HUE_TABS,
  COLOR_GRADING_SHARED,
  COLOR_GRADING_TABS,
  GROUPS,
  applyChanges,
  beforeRecipe,
  changeLabel,
  flipRecipe,
  rotateRecipe,
  groupResetChanges,
  sliderChanges,
  toneChanges,
  type ControlDef,
  type GroupDef,
} from '../edit-controls';
import { isPreviewStale, isTypingTarget, neighbourId, shortcutFor } from '../edit-keys';
import type { DevelopEngine, PhotoInfo } from '../../engine/develop-engine';
import type { DevelopProfile } from '../../engine/profiles';
import { Histogram } from '../Histogram/Histogram';
import { CropTool } from '../CropTool/CropTool';
import { FULL_RECT, recipeCrop, toFramed, type Rect } from '../../engine/crop';
import { ProfileMenu } from '../ProfileMenu/ProfileMenu';
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
  /**
   * Edit in Lopsy. Called inside the button's click, so the app can open
   * Lopsy's window there; `renderPng16` renders the current edit full-size
   * as a 16-bit PNG. The button is hidden without it.
   */
  readonly onEditInLopsy?: (renderPng16: () => Promise<ArrayBuffer>) => void;
  /** The version's history, oldest first (`LibrarySession.history`). Shows the History list. */
  readonly history?: readonly HistoryStep[];
  /** The photo's versions. Shows the Versions list. */
  readonly versions?: readonly Version[];
  readonly onSelectVersion?: (versionId: VersionId) => void;
  /** A new version holding the current edit (`createVersion(assetId, name, recipe)`); the app then shows it. */
  readonly onCreateVersion?: (name: string, recipe: Recipe) => void;
  readonly onRenameVersion?: (versionId: VersionId, name: string) => void;
  readonly onDeleteVersion?: (versionId: VersionId) => void;
  /** Copy edits (⌘⇧C): the app asks which groups and keeps them. */
  readonly onCopyEdits?: (recipe: Recipe) => void;
  /** Paste edits (⌘⇧V) onto this version; the app applies them as one step. Disabled when `canPasteEdits` is false. */
  readonly onPasteEdits?: () => void;
  readonly canPasteEdits?: boolean;
  /** The current view's photos along the bottom; ← and → move along it. */
  readonly filmstrip?: { readonly items: readonly FilmstripItem[]; readonly currentId: string; readonly onOpen: (assetId: string) => void } | undefined;
}

/** How long the edit must stay unchanged before previews are rendered. */
const SETTLE_MS = 1200;
const THUMB_SIZE = 512;
/** How long the edit must rest before the histogram is read again. */
const HISTOGRAM_DELAY_MS = 200;
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
  onEditInLopsy,
  history,
  versions,
  onSelectVersion,
  onCreateVersion,
  onRenameVersion,
  onDeleteVersion,
  filmstrip,
  onCopyEdits,
  onPasteEdits,
  canPasteEdits = true,
}: EditViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { engine, status, view } = usePhotoEngine(canvasRef, asset, loadOriginal);
  const [draft, setDraft] = useState<Readonly<Record<string, Json>> | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [isBeforeToggled, setIsBeforeToggled] = useState(false);
  const [isBeforeHeld, setIsBeforeHeld] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const isCropping = cropDraft !== null;
  const isReady = status.kind === 'ready';
  /** A first view is on screen while the full-size image decodes: edits apply to both. */
  const isRefining = status.kind === 'loading' && status.progress?.stage === 'refining';
  const canEdit = isReady || isRefining;
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
  useEffect(() => {
    previewed.current = { thumbHash: version.thumb?.recipeHash ?? null, screenHash: version.screen?.recipeHash ?? null };
    // Only a switch to another version restarts what the previews are compared with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id]);
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
    (control: ControlDef, value: number) => commit(sliderChanges(control.path, value), changeLabel(control.historyLabel ?? control.label, control.path, value)),
    [commit],
  );

  const handleGroupReset = useCallback(
    (group: GroupDef) => commit(groupResetChanges(savedRecipe, group), `Reset ${group.title}`),
    [commit, savedRecipe],
  );

  // ---- photo info, histogram, Auto and Profile -----------------------

  const [photoInfo, setPhotoInfo] = useState<PhotoInfo | null>(null);
  useEffect(() => {
    if (engine && canEdit) setPhotoInfo(engine.photoInfo());
  }, [engine, canEdit, status.kind]);

  const [histogram, setHistogram] = useState<Uint32Array | null>(null);
  useEffect(() => {
    if (!engine || !canEdit || draft) return;
    let isCancelled = false;
    const timer = setTimeout(() => {
      engine
        .readHistogram()
        .then((bins) => {
          if (!isCancelled && bins) setHistogram(bins);
        })
        .catch((err: unknown) => console.warn('Lopsy Photos: the histogram could not be read', err));
    }, HISTOGRAM_DELAY_MS);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [engine, canEdit, status.kind, shownRecipe, isBefore, draft]);

  const handleAutoTone = useCallback(async () => {
    if (!engine) return;
    try {
      const tone = await engine.autoTone(savedRecipe);
      commit(toneChanges(savedRecipe, tone), 'Auto tone');
    } catch (err) {
      console.error('Lopsy Photos: Auto tone failed', err);
    } finally {
      engine.setRecipe(isBefore ? beforeRecipe(shownRecipe) : shownRecipe);
    }
  }, [engine, savedRecipe, shownRecipe, isBefore, commit]);

  const autoWhiteBalance = photoInfo?.autoWhiteBalance ?? null;
  const handleAutoWhiteBalance = useCallback(() => {
    if (!autoWhiteBalance) return;
    commit(
      {
        'whiteBalance.temperature': autoWhiteBalance.temperature,
        'whiteBalance.tint': autoWhiteBalance.tint,
        'whiteBalance.mode': 'custom',
      },
      'Auto white balance',
    );
  }, [autoWhiteBalance, commit]);

  const handleProfile = useCallback(
    (profile: DevelopProfile) => {
      if (profile.id !== savedRecipe.profile.id) commit({ 'profile.id': profile.id }, `Profile: ${profile.name}`);
    },
    [commit, savedRecipe.profile.id],
  );

  // ---- keyboard ------------------------------------------------------

  const handleCopyPaste = (which: 'copyEdits' | 'pasteEdits') => {
    if (!canEdit || isCropping) return;
    if (which === 'copyEdits') onCopyEdits?.(savedRecipe);
    else onPasteEdits?.();
  };
  const handlers = useRef({ onUndo, onRedo, engine, filmstrip, isCropping: false, onCopyPaste: handleCopyPaste });
  handlers.current = { onUndo, onRedo, engine, filmstrip, isCropping, onCopyPaste: handleCopyPaste };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      const h = handlers.current;
      if (shortcut === 'previous' || shortcut === 'next') {
        const strip = h.filmstrip;
        if (!strip || h.isCropping) return;
        const next = neighbourId(strip.items.map((i) => i.id), strip.currentId, shortcut === 'next' ? 1 : -1);
        if (!next) return;
        e.preventDefault();
        strip.onOpen(next);
        return;
      }
      if (shortcut === 'copyEdits' || shortcut === 'pasteEdits') {
        e.preventDefault();
        h.onCopyPaste(shortcut);
        return;
      }
      e.preventDefault();
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

  // ---- crop ----------------------------------------------------------


  const startCrop = () => {
    if (!engine) return;
    engine.setCropEditing(true);
    const crop = savedRecipe.framing.crop;
    setCropDraft(crop ? toFramed(crop, savedRecipe.framing) : FULL_RECT);
  };

  const finishCrop = (isCommit: boolean) => {
    engine?.setCropEditing(false);
    const draftRect = cropDraft;
    setCropDraft(null);
    if (!isCommit || !draftRect) return;
    const next = recipeCrop(draftRect, savedRecipe.framing);
    if (JSON.stringify(next) !== JSON.stringify(savedRecipe.framing.crop)) commit({ 'framing.crop': next as Json }, 'Crop');
  };

  const fullSize = isCropping ? engine?.fullImageSize() ?? null : null;
  const stageSize = stageRef.current ? { width: stageRef.current.clientWidth, height: stageRef.current.clientHeight } : null;
  const cropBox =
    fullSize && stageSize && view
      ? {
          aspect: fullSize.width / fullSize.height,
          box: {
            left: stageSize.width / 2 + view.panX - (fullSize.width * view.zoom) / 2,
            top: stageSize.height / 2 + view.panY - (fullSize.height * view.zoom) / 2,
            width: fullSize.width * view.zoom,
            height: fullSize.height * view.zoom,
          },
        }
      : null;

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

  const handleEditInLopsy = () => {
    if (!engine || !onEditInLopsy) return;
    const recipe = savedRecipe;
    onEditInLopsy(async () => {
      engine.setRecipe(recipe);
      try {
        const png = await engine.exportImage({ format: 'png' });
        return await png.arrayBuffer();
      } finally {
        engine.setRecipe(isBefore ? beforeRecipe(shownRecipe) : shownRecipe);
      }
    });
  };

  // ---- left column ---------------------------------------------------

  const handleGoTo = (stepId: string) => {
    if (!history) return;
    const moves = movesTo(history, stepId);
    for (let i = 0; i < moves.undo; i++) onUndo();
    for (let i = 0; i < moves.redo; i++) onRedo();
  };

  const leftSections: LeftColumnSection[] = [];
  if (versions && onSelectVersion) {
    leftSections.push({
      id: 'versions',
      title: 'Versions',
      content: (
        <VersionsPanel
          versions={versions}
          currentId={version.id}
          isDisabled={isBusy || isCropping}
          onSelect={onSelectVersion}
          {...(onCreateVersion ? { onCreate: (name: string) => onCreateVersion(name, savedRecipe) } : {})}
          {...(onRenameVersion ? { onRename: onRenameVersion } : {})}
          {...(onDeleteVersion ? { onDelete: onDeleteVersion } : {})}
        />
      ),
    });
  }
  if (history) {
    leftSections.push({
      id: 'history',
      title: 'History',
      content: <HistoryPanel history={history} isDisabled={!canEdit || isCropping} onGoTo={handleGoTo} />,
    });
  }

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
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, false), 'Rotate left')}
          >
            <RotateCcw size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate right"
            title="Rotate right"
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, true), 'Rotate right')}
          >
            <RotateCw size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Flip"
            title="Flip left to right"
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => onSetRecipe(flipRecipe(savedRecipe), 'Flip')}
          >
            <FlipHorizontal2 size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Crop"
            title="Crop"
            aria-pressed={isCropping}
            disabled={!canEdit || isBefore}
            onClick={() => (isCropping ? finishCrop(true) : startCrop())}
          >
            <Crop size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={isBeforeToggled}
            title="Before and after (hold \)"
            onClick={() => setIsBeforeToggled((v) => !v)}
            disabled={!canEdit}
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
            disabled={!canEdit}
          >
            Fit
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={!view?.isFit && zoomPercent === 100}
            onClick={() => engine?.setZoom(1)}
            disabled={!canEdit}
          >
            100%
          </button>
          <span className={styles.zoomReadout} data-testid="zoom-readout">
            {zoomPercent}%
          </span>
        </div>
        {(onCopyEdits || onPasteEdits) && (
          <div className={styles.toolGroup}>
            {onCopyEdits && (
              <button type="button" className={styles.iconButton} aria-label="Copy edits" title="Copy edits (⇧⌘C)" disabled={!canEdit || isCropping} onClick={() => handleCopyPaste('copyEdits')}>
                <Copy size={16} aria-hidden />
              </button>
            )}
            {onPasteEdits && (
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Paste edits"
                title="Paste edits (⇧⌘V)"
                disabled={!canEdit || isCropping || !canPasteEdits}
                onClick={() => handleCopyPaste('pasteEdits')}
              >
                <ClipboardPaste size={16} aria-hidden />
              </button>
            )}
          </div>
        )}
        {onEditInLopsy && (
          <button type="button" className={styles.toolButton} onClick={handleEditInLopsy} disabled={!isReady || isBusy}>
            <SquarePen size={16} aria-hidden />
            <span>Edit in Lopsy</span>
          </button>
        )}
        {onExport && (
          <button type="button" className={styles.primaryButton} onClick={() => void handleExport()} disabled={!isReady || isBusy}>
            <Download size={16} aria-hidden />
            <span>Export</span>
          </button>
        )}
      </header>
      <div className={styles.body}>
        <LeftColumn sections={leftSections} />
        <div
          ref={stageRef}
          className={styles.stage}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
          <canvas ref={canvasRef} className={styles.canvas} data-testid="edit-canvas" />
          {cropDraft && cropBox && (
            <CropTool
              imageBox={cropBox.box}
              imageAspect={cropBox.aspect}
              rect={cropDraft}
              onChange={setCropDraft}
              onDone={() => finishCrop(true)}
              onCancel={() => finishCrop(false)}
            />
          )}
          {isBefore && canEdit && <span className={styles.beforeBadge}>Before</span>}
          <LoadStatus status={status} onClose={onClose} />
        </div>
        <aside className={styles.panel} aria-label="Edits">
          <Histogram bins={histogram} />
          {photoInfo && (
            <ProfileMenu
              profiles={photoInfo.profiles}
              profileId={shownRecipe.profile.id}
              isDisabled={!canEdit || isBefore}
              onSelect={handleProfile}
            />
          )}
          {GROUPS.map((group) => (
            <Fragment key={group.id}>
            <ControlGroup
              group={group}
              recipe={shownRecipe}
              isDisabled={!canEdit || isBefore}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
              onReset={handleGroupReset}
              {...(group.id === 'tone'
                ? { onAuto: () => void handleAutoTone(), autoTitle: 'Set the tone controls from the histogram' }
                : group.id === 'whiteBalance' && autoWhiteBalance
                  ? { onAuto: handleAutoWhiteBalance, autoTitle: 'Neutralise the colour cast' }
                  : {})}
            />
            {group.id === 'tone' && (
              <CurvesGroup recipe={shownRecipe} isDisabled={!canEdit || isBefore} onDraft={setDraft} onCommit={commit} />
            )}
            {group.id === 'color' && (
              <>
                <TabbedGroup
                  title="Color by hue"
                  tabs={COLOR_BY_HUE_TABS}
                  recipe={shownRecipe}
                  isDisabled={!canEdit || isBefore}
                  onChange={handleSliderChange}
                  onCommit={handleSliderCommit}
                  onReset={commit}
                />
                <TabbedGroup
                  title="Color Grading"
                  tabs={COLOR_GRADING_TABS}
                  sharedControls={COLOR_GRADING_SHARED}
                  recipe={shownRecipe}
                  isDisabled={!canEdit || isBefore}
                  onChange={handleSliderChange}
                  onCommit={handleSliderCommit}
                  onReset={commit}
                />
              </>
            )}
            </Fragment>
          ))}
          <div className={styles.panelFooter}>
            <button
              type="button"
              className={styles.toolButton}
              disabled={!canEdit || isBefore || isAllDefault}
              onClick={() => onSetRecipe(beforeRecipe(savedRecipe), 'Reset all edits')}
            >
              Reset all
            </button>
          </div>
        </aside>
      </div>
      {filmstrip && <Filmstrip items={filmstrip.items} currentId={filmstrip.currentId} onOpen={filmstrip.onOpen} />}
    </div>
  );
}
