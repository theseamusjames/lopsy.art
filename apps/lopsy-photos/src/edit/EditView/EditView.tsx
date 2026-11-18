import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, Check, ClipboardPaste, Copy, Crop, Spline, Eye, FlipVertical2, Download, FlipHorizontal2, SquarePen, Redo2, RotateCcw, RotateCw, SplitSquareHorizontal, Undo2 } from 'lucide-react';
import { DEFAULT_RECIPE, recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, HistoryStep, Json, Preset, PresetId, Version, VersionId } from '@lopsy/photos-core/library/types';
import { DEFAULT_COPY_GROUPS, RECIPE_GROUPS, addArea, liveAreas, pickGroups, removeArea, type AreaKind, type RecipeGroupId } from '@lopsy/photos-core/library/recipe';
import type { CopiedEdits } from '../../library/recipe-copy';
import { CopyEditsDialog } from '../../components/CopyEditsDialog/CopyEditsDialog';
import { PresetsPanel } from '../PresetsPanel/PresetsPanel';
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
  FRAMING_GROUP,
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
import { EDIT_SHORTCUTS, isTypingTarget, neighbourId, shortcutFor } from '../edit-keys';
import { Modal } from '../../components/Modal/Modal';
import type { PhotoInfo } from '../../engine/develop-engine';
import type { DevelopProfile } from '../../engine/profiles';
import { Histogram } from '../Histogram/Histogram';
import { CropTool } from '../CropTool/CropTool';
import { WhiteBalanceMenu } from '../WhiteBalanceMenu/WhiteBalanceMenu';
import { WhiteBalancePicker } from '../WhiteBalancePicker/WhiteBalancePicker';
import { kelvinDisplay } from '../../engine/white-balance';
import { AreasPanel } from '../AreasPanel/AreasPanel';
import { AreaHandles } from '../AreaHandles/AreaHandles';
import { areaLabel } from '../area-edit';
import { newId } from '@lopsy/photos-core/library/ids';
import { LevelTool } from '../LevelTool/LevelTool';
import { SplitView } from '../SplitView/SplitView';
import { FULL_RECT, levelAngle, recipeCrop, toFramed, type Rect } from '../../engine/crop';
import { effectiveFraming, framingAngle, framingFlipV } from '../../engine/recipe-to-adjustments';
import { ProfileMenu } from '../ProfileMenu/ProfileMenu';
import { LoadStatus } from '../LoadStatus/LoadStatus';
import { usePhotoEngine } from './use-photo-engine';
import { usePreviews } from './use-previews';
import { useSplitBefore } from './use-split-before';
import { usePixelReadout } from './use-pixel-readout';
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
  /** Built-in and the user's edit presets (deleted ones left out). Shows the Presets list. */
  readonly presets?: readonly Preset[];
  /** Save preset…: the current edit's chosen groups (`LibrarySession.savePreset`). */
  readonly onSavePreset?: (name: string, recipe: Recipe, groups: readonly RecipeGroupId[]) => void;
  readonly onDeletePreset?: (presetId: PresetId) => void;
  /**
   * Copy edits (⌘⇧C): the Edit view asks which groups (CopyEditsDialog)
   * and hands over what to keep, as the library's `CopiedEdits`.
   */
  readonly onCopyEdits?: (copied: CopiedEdits) => void;
  /** Paste edits (⌘⇧V) onto this version; the app applies them as one step. Disabled when `canPasteEdits` is false. */
  readonly onPasteEdits?: () => void;
  readonly canPasteEdits?: boolean;
  /** The version's stored screen preview, shown at once while the engine loads the photo. */
  readonly storedPreviewUrl?: string | null;
  /** The current view's photos along the bottom; ← and → move along it. */
  readonly filmstrip?: { readonly items: readonly FilmstripItem[]; readonly currentId: string; readonly onOpen: (assetId: string) => void } | undefined;
  /**
   * Layer mode (Grade in Lopsy Photos): a Done button that hands over the
   * saved recipe and a renderer of the full-size 16-bit PNG. Export and
   * Edit in Lopsy are not offered then.
   */
  readonly onDone?: (renderPng16: () => Promise<ArrayBuffer>, recipe: Recipe) => void;
  /** The leave button's words; 'Library' by default. */
  readonly closeLabel?: string;
}

/** Recipe paths of the controls whose engine passes are costly. */
const DETAIL_PREFIXES = ['sharpness.', 'noise.', 'localContrast.'];

/** How long the edit must rest before the histogram is read again. */
const HISTOGRAM_DELAY_MS = 200;
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
  storedPreviewUrl = null,
  onCopyEdits,
  onPasteEdits,
  canPasteEdits = true,
  presets,
  onSavePreset,
  onDeletePreset,
  onDone,
  closeLabel = 'Library',
}: EditViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { engine, status, view } = usePhotoEngine(canvasRef, asset, loadOriginal);
  const [draft, setDraft] = useState<Readonly<Record<string, Json>> | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [isBeforeToggled, setIsBeforeToggled] = useState(false);
  const [isBeforeHeld, setIsBeforeHeld] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isLevelling, setIsLevelling] = useState(false);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const isCropping = cropDraft !== null;
  const isReady = status.kind === 'ready';
  const canEdit = isReady;
  const isBefore = isBeforeToggled || isBeforeHeld;

  const savedRecipe = committed?.base === version.recipe ? applyChanges(version.recipe, committed.changes) : version.recipe;
  const shownRecipe = useMemo(() => (draft ? applyChanges(savedRecipe, draft) : savedRecipe), [savedRecipe, draft]);
  const [hoverPreset, setHoverPreset] = useState<Preset | null>(null);
  const displayedRecipe = useMemo(
    () => (hoverPreset ? applyChanges(shownRecipe, hoverPreset.values) : shownRecipe),
    [shownRecipe, hoverPreset],
  );

  // A committed edit only bridges the moment until the library hands back
  // the new recipe; once it has, an undo back to the old recipe object must
  // not bring the edit back.
  useEffect(() => {
    setCommitted(null);
  }, [version.recipe]);

  // Dragging a slider outside Local contrast and Sharpness & noise leaves
  // their costly passes out until it is let go.
  const isDraggingCheapControl = draft !== null && !Object.keys(draft).some((path) => DETAIL_PREFIXES.some((p) => path.startsWith(p)));
  useEffect(() => {
    engine?.setInteractive(isDraggingCheapControl);
  }, [engine, isDraggingCheapControl]);

  /** What the canvas shows: the edit (with a hovered preset), or Before. */
  const engineRecipe = useMemo(() => (isBefore ? beforeRecipe(displayedRecipe) : displayedRecipe), [isBefore, displayedRecipe]);
  useEffect(() => {
    engine?.setRecipe(engineRecipe);
  }, [engine, engineRecipe]);

  // ---- previews ------------------------------------------------------

  const { refreshPreviews } = usePreviews(engine, version, savedRecipe, isReady && !draft && !isBefore, onPreviewRendered);

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
      engine.setRecipe(engineRecipe);
    }
  }, [engine, savedRecipe, engineRecipe, commit]);

  const autoWhiteBalance = photoInfo?.autoWhiteBalance ?? null;
  const whiteBalancePresets = useMemo(() => photoInfo?.whiteBalancePresets ?? [], [photoInfo]);
  const kelvinScale = photoInfo?.kelvin ?? null;
  const temperatureDisplays = useMemo(
    () => (kelvinScale ? { 'whiteBalance.temperature': kelvinDisplay(kelvinScale) } : null),
    [kelvinScale],
  );
  const [isPickingWb, setIsPickingWb] = useState(false);
  const handleWhiteBalancePick = useCallback(
    async (x: number, y: number) => {
      setIsPickingWb(false);
      const picked = await engine?.sampleWhiteBalance(x, y, 8);
      if (!picked) return;
      commit(
        {
          'whiteBalance.mode': 'custom',
          'whiteBalance.temperature': Math.round(picked.temperature),
          'whiteBalance.tint': Math.round(picked.tint),
        },
        'White balance: picked',
      );
    },
    [engine, commit],
  );
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
    if (which === 'copyEdits') {
      if (onCopyEdits) setIsCopyDialogOpen(true);
    } else onPasteEdits?.();
  };
  // Set once the tools below are defined; the key handler reads it.
  const toolShortcuts = useRef<(shortcut: 'crop' | 'linearArea' | 'radialArea') => void>(() => undefined);
  const isToolOpen = isCropping || isLevelling || isCopyDialogOpen || isHelpOpen;
  const handlers = useRef({ onUndo, onRedo, engine, filmstrip, isCropping: false, onCopyPaste: handleCopyPaste, isToolOpen, leave: () => {} });
  handlers.current = { onUndo, onRedo, engine, filmstrip, isCropping, onCopyPaste: handleCopyPaste, isToolOpen, leave: () => void handleClose() };

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
      if (shortcut === 'crop' || shortcut === 'linearArea' || shortcut === 'radialArea') {
        e.preventDefault();
        toolShortcuts.current(shortcut);
        return;
      }
      if (shortcut === 'leave') {
        // A tool or dialog takes Escape for itself.
        if (h.isToolOpen) return;
        e.preventDefault();
        h.leave();
        return;
      }
      if (shortcut === 'help') {
        e.preventDefault();
        setIsHelpOpen(true);
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
      else if (shortcut === 'actualSize') h.engine?.setZoom(1 / (h.engine.workingScale() || 1));
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
    setCropDraft(crop ? toFramed(crop, effectiveFraming(savedRecipe.framing)) : FULL_RECT);
  };

  const finishCrop = (isCommit: boolean) => {
    engine?.setCropEditing(false);
    const draftRect = cropDraft;
    setCropDraft(null);
    if (!isCommit || !draftRect) return;
    const next = recipeCrop(draftRect, effectiveFraming(savedRecipe.framing));
    if (JSON.stringify(next) !== JSON.stringify(savedRecipe.framing.crop)) commit({ 'framing.crop': next as Json }, 'Crop');
  };

  const fullSize = isCropping ? engine?.fullImageSize() ?? null : null;
  const stageSize = stageRef.current ? { width: stageRef.current.clientWidth, height: stageRef.current.clientHeight } : null;
  const boxOf = (size: { width: number; height: number } | null) =>
    size && stageSize && view
      ? {
          left: stageSize.width / 2 + view.panX - (size.width * view.zoom) / 2,
          top: stageSize.height / 2 + view.panY - (size.height * view.zoom) / 2,
          width: size.width * view.zoom,
          height: size.height * view.zoom,
        }
      : null;
  const cropImageBox = boxOf(fullSize);
  const cropBox = fullSize && cropImageBox ? { aspect: fullSize.width / fullSize.height, box: cropImageBox } : null;

  // ---- straighten -----------------------------------------------------

  const hasFlipV = 'flipV' in DEFAULT_RECIPE.framing;
  const handleLevelLine = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    setIsLevelling(false);
    const delta = levelAngle(a, b);
    if (delta === 0) return;
    const angle = Math.round(Math.max(-45, Math.min(45, framingAngle(savedRecipe.framing) + delta)) * 100) / 100;
    commit({ 'framing.angle': angle }, changeLabel('Straighten', 'framing.angle', angle));
  };

  // ---- areas ----------------------------------------------------------

  const [isAreasOpen, setIsAreasOpen] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const shownAreas = liveAreas(shownRecipe);
  const selectedArea = isAreasOpen ? shownAreas.find((a) => a.id === selectedAreaId) ?? null : null;
  const labelOfArea = (id: string) => {
    const index = shownAreas.findIndex((a) => a.id === id);
    const area = shownAreas[index];
    return area ? areaLabel(area, index) : 'Area';
  };

  useEffect(() => {
    engine?.setAreaOverlay(isAreasOpen && selectedAreaId ? selectedAreaId : null);
  }, [engine, isAreasOpen, selectedAreaId]);

  const handleAddArea = (kind: AreaKind) => {
    const id = newId();
    const added = addArea(savedRecipe, kind, id);
    if (!added) return;
    commit(added.values, kind === 'linear' ? 'Add linear area' : 'Add radial area');
    setSelectedAreaId(id);
  };

  toolShortcuts.current = (shortcut) => {
    if (!canEdit || isBefore) return;
    if (shortcut === 'crop') {
      if (isCropping) finishCrop(true);
      else startCrop();
      return;
    }
    if (isCropping) return;
    setIsAreasOpen(true);
    handleAddArea(shortcut === 'linearArea' ? 'linear' : 'radial');
  };

  const areaFrame = selectedArea && canEdit && !isCropping ? engine?.areaFrame() ?? null : null;
  const docSize = areaFrame ? engine?.imageSize() ?? null : null;
  const areaBox = boxOf(docSize);
  const areaHandles =
    selectedArea && areaFrame && docSize && areaBox ? (
      <AreaHandles
        area={selectedArea}
        frame={areaFrame}
        box={areaBox}
        docWidth={docSize.width}
        onDraft={(geometry) => setDraft({ [`areas.${selectedArea.id}.geometry`]: { ...geometry } })}
        onCommit={(geometry, label) => commit({ [`areas.${selectedArea.id}.geometry`]: { ...geometry } }, label)}
      />
    ) : null;

  // ---- split before and after ---------------------------------------

  const [isSplit, setIsSplit] = useState(false);
  const [splitAt, setSplitAt] = useState(0.5);
  const isSplitShown = isSplit && canEdit && !isCropping;
  const wbDocSize = isPickingWb ? engine?.imageSize() ?? null : null;
  const wbPickBox = boxOf(wbDocSize);
  const splitBox = isSplitShown ? boxOf(engine?.imageSize() ?? null) : null;
  const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const beforeSrc = useSplitBefore(
    engine,
    savedRecipe,
    engineRecipe,
    splitBox ? Math.max(splitBox.width, splitBox.height) * pixelRatio : 0,
    status.kind,
  );

  const panPointer = useRef<{ id: number; x: number; y: number } | null>(null);

  const handleStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !engine || e.target !== canvasRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const handleStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = panPointer.current;
    if (!p || p.id !== e.pointerId || !engine) {
      pixel.onPointerMove(e.clientX, e.clientY);
      return;
    }
    engine.panBy(e.clientX - p.x, e.clientY - p.y);
    panPointer.current = { id: p.id, x: e.clientX, y: e.clientY };
  };

  // ---- pixel readout ---------------------------------------------------

  const pixel = usePixelReadout((clientX, clientY) => {
    const stage = stageRef.current;
    const size = engine?.imageSize() ?? null;
    const box = boxOf(size);
    if (!stage || !engine || !size || !box || !canEdit) return null;
    const rect = stage.getBoundingClientRect();
    const scale = box.width / size.width;
    return engine.sampleAt((clientX - rect.left - box.left) / scale, (clientY - rect.top - box.top) / scale);
  });

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
      engine.setRecipe(engineRecipe);
      setIsBusy(false);
    }
  };

  /** A renderer of `recipe` as a full-size 16-bit PNG, for Edit in Lopsy and Done. */
  const fullPng16 = (recipe: Recipe) => async (): Promise<ArrayBuffer> => {
    if (!engine) throw new Error('The editing engine is not running');
    engine.setRecipe(recipe);
    try {
      const png = await engine.exportImage({ format: 'png' });
      return await png.arrayBuffer();
    } finally {
      engine.setRecipe(engineRecipe);
    }
  };

  const handleEditInLopsy = () => {
    if (engine && onEditInLopsy) onEditInLopsy(fullPng16(savedRecipe));
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
  if (presets) {
    leftSections.unshift({
      id: 'presets',
      title: 'Presets',
      content: (
        <PresetsPanel
          presets={presets}
          recipe={savedRecipe}
          isDisabled={!canEdit || isCropping || isBefore}
          onApply={(preset) => commit(preset.values, `Preset: ${preset.name}`)}
          onPreview={setHoverPreset}
          {...(onSavePreset ? { onSave: (name: string, groups: readonly RecipeGroupId[]) => onSavePreset(name, savedRecipe, groups) } : {})}
          {...(onDeletePreset ? { onDelete: onDeletePreset } : {})}
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

  const handleDone = () => {
    if (engine && onDone) onDone(fullPng16(savedRecipe), savedRecipe);
  };

  const isAllDefault = recipeHash(beforeRecipe(savedRecipe)) === recipeHash(savedRecipe);
  // The zoom against the full image, whatever size the working image is.
  const workingScale = engine?.workingScale() ?? 1;
  const zoomPercent = view ? Math.round(view.zoom * workingScale * 100) : 100;
  const isLoadingFull = engine?.isLoadingFullResolution() ?? false;

  return (
    <div className={styles.editView} data-testid="edit-view" data-status={status.kind}>
      <header className={styles.toolbar}>
        <button type="button" className={styles.toolButton} onClick={() => void handleClose()} disabled={isBusy}>
          <ArrowLeft size={16} aria-hidden />
          <span>{closeLabel}</span>
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
          {hasFlipV && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Flip vertical"
              title="Flip top to bottom"
              disabled={!canEdit || isBefore || isCropping}
              onClick={() => commit({ 'framing.flipV': !framingFlipV(savedRecipe.framing) }, 'Flip vertical')}
            >
              <FlipVertical2 size={16} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Crop"
            title="Crop (R)"
            aria-pressed={isCropping}
            disabled={!canEdit || isBefore}
            onClick={() => (isCropping ? finishCrop(true) : startCrop())}
          >
            <Crop size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Areas"
            title="Areas (M linear, ⇧M radial)"
            aria-pressed={isAreasOpen}
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => setIsAreasOpen((v) => !v)}
          >
            <Spline size={16} aria-hidden />
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
            <Eye size={16} aria-hidden />
            <span>Before</span>
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={isSplit}
            title="Before and after side by side"
            onClick={() => setIsSplit((v) => !v)}
            disabled={!canEdit || isCropping}
          >
            <SplitSquareHorizontal size={16} aria-hidden />
            <span>Split</span>
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
            onClick={() => engine?.setZoom(1 / workingScale)}
            disabled={!canEdit}
          >
            100%
          </button>
          <span
            className={styles.zoomReadout}
            data-testid="zoom-readout"
            title={
              view?.isFit
                ? `Fit: the whole photo, shown at ${zoomPercent}% of its full size`
                : `${zoomPercent}% of the photo's full size`
            }
          >
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
        {onDone && (
          <button type="button" className={styles.primaryButton} onClick={handleDone} disabled={!isReady || isBusy}>
            <Check size={16} aria-hidden />
            <span>Done</span>
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
          onPointerLeave={pixel.onPointerLeave}
        >
          <canvas ref={canvasRef} className={styles.canvas} data-testid="edit-canvas" />
          {storedPreviewUrl && !canEdit && status.kind !== 'error' && (
            <img className={styles.storedPreview} src={storedPreviewUrl} alt="" data-testid="stored-preview" draggable={false} />
          )}
          {(isLoadingFull || (storedPreviewUrl && !canEdit && status.kind !== 'error')) && (
            <span className={styles.loadingBadge} role="status" data-testid="loading-badge">
              {isLoadingFull ? 'Loading full resolution…' : 'Loading…'}
            </span>
          )}
          {isPickingWb && wbPickBox && wbDocSize && (
            <WhiteBalancePicker
              imageBox={wbPickBox}
              documentSize={wbDocSize}
              onPick={(x, y) => void handleWhiteBalancePick(x, y)}
              onCancel={() => setIsPickingWb(false)}
            />
          )}
          {isLevelling && <LevelTool onLine={handleLevelLine} onCancel={() => setIsLevelling(false)} />}
          {areaHandles}
          {pixel.readout && (
            <span className={styles.pixelReadout} data-testid="pixel-readout" aria-label="Colour under the pointer">
              R {pixel.readout[0]} G {pixel.readout[1]} B {pixel.readout[2]}
            </span>
          )}
          {splitBox && <SplitView imageBox={splitBox} beforeSrc={beforeSrc} at={splitAt} onChange={setSplitAt} />}
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
          {!(storedPreviewUrl && status.kind !== 'error' && !canEdit) && <LoadStatus status={status} onClose={onClose} />}
        </div>
        <aside className={styles.panel} aria-label="Edits">
          <Histogram bins={histogram} />
          {isAreasOpen && (
            <AreasPanel
              recipe={shownRecipe}
              selectedId={selectedAreaId}
              isDisabled={!canEdit || isBefore || isCropping}
              onAdd={handleAddArea}
              onSelect={setSelectedAreaId}
              onRename={(id, name) => commit({ [`areas.${id}.name`]: name }, 'Rename area')}
              onInvert={(id, isInverted) => commit({ [`areas.${id}.invert`]: isInverted }, `${labelOfArea(id)} ${isInverted ? 'inverted' : 'not inverted'}`)}
              onDelete={(id) => {
                commit(removeArea(id), `Delete ${labelOfArea(id)}`);
                if (selectedAreaId === id) setSelectedAreaId(null);
              }}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
            />
          )}
          {photoInfo && (
            <ProfileMenu
              profiles={photoInfo.profiles}
              profileId={shownRecipe.profile.id}
              isDisabled={!canEdit || isBefore}
              onSelect={handleProfile}
            />
          )}
          {FRAMING_GROUP && (
            <ControlGroup
              group={FRAMING_GROUP}
              recipe={shownRecipe}
              isDisabled={!canEdit || isBefore || isCropping}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
              onReset={handleGroupReset}
              onAuto={() => setIsLevelling((v) => !v)}
              autoLabel={isLevelling ? 'Cancel' : 'Level'}
              autoTitle="Draw along something that should be level"
            />
          )}
          {GROUPS.map((group) => (
            <Fragment key={group.id}>
            {group.id === 'whiteBalance' && (
              <WhiteBalanceMenu
                recipe={shownRecipe}
                auto={autoWhiteBalance}
                presets={whiteBalancePresets}
                isDisabled={!canEdit || isBefore}
                onCommit={commit}
                isPicking={isPickingWb}
                onTogglePicker={() => setIsPickingWb((v) => !v)}
              />
            )}
            <ControlGroup
              group={group}
              recipe={shownRecipe}
              isDisabled={!canEdit || isBefore}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
              onReset={handleGroupReset}
              {...(group.id === 'tone'
                ? {
                    onAuto: () => void handleAutoTone(),
                    autoTitle: canEdit ? 'Set the tone controls from the histogram' : 'Auto is ready once the photo has loaded',
                  }
                : group.id === 'whiteBalance' && autoWhiteBalance
                  ? { onAuto: handleAutoWhiteBalance, autoTitle: canEdit ? 'Neutralise the colour cast' : 'Auto is ready once the photo has loaded' }
                  : {})}
              {...(group.id === 'whiteBalance' && temperatureDisplays ? { displays: temperatureDisplays } : {})}
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
      {isHelpOpen && (
        <Modal title="Edit shortcuts" width="sm" onClose={() => setIsHelpOpen(false)}>
          <dl className={styles.shortcuts}>
            {EDIT_SHORTCUTS.map((s) => (
              <div key={s.keys} className={styles.shortcut}>
                <dt>
                  <kbd className={styles.kbd}>{s.keys}</kbd>
                </dt>
                <dd>{s.action}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
      {isCopyDialogOpen && onCopyEdits && (
        <CopyEditsDialog
          sourceName={asset.fileName}
          groups={RECIPE_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
          initial={DEFAULT_COPY_GROUPS}
          onCopy={(ids) => {
            setIsCopyDialogOpen(false);
            const groupIds = RECIPE_GROUPS.map((g) => g.id).filter((id) => ids.includes(id));
            onCopyEdits({ values: pickGroups(savedRecipe, groupIds), groupIds, sourceName: asset.fileName });
          }}
          onClose={() => setIsCopyDialogOpen(false)}
        />
      )}
      {filmstrip && <Filmstrip items={filmstrip.items} currentId={filmstrip.currentId} onOpen={filmstrip.onOpen} />}
    </div>
  );
}
