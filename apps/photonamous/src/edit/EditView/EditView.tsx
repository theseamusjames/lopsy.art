import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, Check, ClipboardCopy, ClipboardPaste, Copy, Crop, Spline, Eye, FlipVertical2, Download, FlipHorizontal2, History, Paintbrush, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcwSquare, RotateCwSquare, SlidersHorizontal, SplitSquareHorizontal, Undo2, Wand2, X } from 'lucide-react';
import { DEFAULT_RECIPE, recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, HistoryStep, Json, Preset, PresetId, Version, VersionId } from '@lopsy/photos-core/library/types';
import {
  DEFAULT_COPY_GROUPS,
  RECIPE_GROUPS,
  addArea,
  duplicateArea,
  liveAreas,
  pickGroups,
  removeArea,
  type AreaKind,
  type LinearGeometry,
  type RadialGeometry,
  type RecipeGroupId,
} from '@lopsy/photos-core/library/recipe';
import type { CopiedEdits } from '../../library/recipe-copy';
import { CopyEditsDialog } from '../../components/CopyEditsDialog/CopyEditsDialog';
import { PresetsPanel } from '../PresetsPanel/PresetsPanel';
import { LeftColumn, type LeftColumnSection } from '../LeftColumn/LeftColumn';
import { HistoryPanel } from '../HistoryPanel/HistoryPanel';
import { VersionsPanel } from '../VersionsPanel/VersionsPanel';
import { movesTo, stepToRedo, stepToUndo } from '../history-nav';
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
  withoutAreas,
  withoutSections,
  SECTIONS,
  sliderChanges,
  toneChanges,
  type ControlDef,
  type GroupDef,
} from '../edit-controls';
import { EDIT_SHORTCUTS, isFieldKey, neighbourId, shortcutFor, stageKeyAction } from '../edit-keys';
import { Modal } from '../../components/Modal/Modal';
import type { PhotoInfo } from '../../engine/develop-engine';
import type { DevelopProfile } from '../../engine/profiles';
import { Histogram } from '../Histogram/Histogram';
import { currentStatus, onStatusChange, showsHdr } from '../../engine/engine-status';
import { ClippingButtons } from '../ClippingButtons/ClippingButtons';
import { ZoomField } from '../ZoomField/ZoomField';
import { CropTool } from '../CropTool/CropTool';
import { WhiteBalanceMenu } from '../WhiteBalanceMenu/WhiteBalanceMenu';
import { WhiteBalancePicker } from '../WhiteBalancePicker/WhiteBalancePicker';
import { isWhiteBalanceWaiting, kelvinDisplay } from '../../engine/white-balance';
import { MaskPanel } from '../MaskPanel/MaskPanel';
import { EditToolbar, type EditTool, type EditToolbarAction } from '../EditToolbar/EditToolbar';
import { useOpenSections } from '../open-sections';
import type { SectionHide } from '../EditSection/EditSection';
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
import { useMaskOverlay } from './use-mask-overlay';
import { usePixelReadout } from './use-pixel-readout';
import { useClippingWarningOnEngine } from '../clipping-warning';
import { useGrainSeed } from '../grain-seed';
import { useAltDragViews } from '../alt-drag-views';
import { editPageTitle, useDocumentTitle, useFocusKept, useFocusOnOpen, useFocusReturn } from '../edit-page';
import { useEditSizes } from './use-edit-sizes';
import { CoalescedReads } from './coalesced-reads';
import styles from './EditView.module.css';
import { NO_INSETS } from '../../engine/viewport';
import { fullSizeNoteText } from '../../engine/full-size';

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
  /** An Export button that renders a full-size JPEG. For the Edit harness: in the app, exporting is the header's Export. */
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
  /** The current view's photos along the bottom; ← and → move along it. `onOpen` gets the item's id. */
  readonly filmstrip?: { readonly items: readonly FilmstripItem[]; readonly currentId: string; readonly onOpen: (id: string) => void } | undefined;
  /**
   * Layer mode (Grade in Photonamous): a Done button that hands over the
   * saved recipe and a renderer of the full-size 16-bit PNG. Export and
   * Edit in Lopsy are not offered then.
   */
  readonly onDone?: (renderPng16: () => Promise<ArrayBuffer>, recipe: Recipe) => void;
  /** The leave button's words; 'Back' by default. */
  readonly closeLabel?: string;
  /**
   * The app's own header is on screen above this view (the library's Edit
   * view). This view's bar of tools is then a named region of the page,
   * not a second banner beside the app's.
   */
  readonly isUnderAppHeader?: boolean;
  /** The page's title while the view is open; "<file name> – Edit – Photonamous" by default. */
  readonly documentTitle?: string;
}

/** Recipe paths of the controls whose engine passes are costly. */
const DETAIL_PREFIXES = ['sharpness.', 'noise.', 'localContrast.'];

/** How long the edit must rest before the histogram is read again. */
const HISTOGRAM_DELAY_MS = 200;
const NO_SECTIONS: ReadonlySet<string> = new Set();
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  closeLabel = 'Back',
  isUnderAppHeader = false,
  documentTitle,
}: EditViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(documentTitle ?? editPageTitle(asset.fileName));
  useFocusOnOpen(headingRef);
  const stageHintId = useId();
  // Status messages for screen readers (WCAG 4.1.3): polite news, and errors, which also show.
  const messageId = useRef(0);
  const [news, setNews] = useState<{ readonly id: number; readonly text: string } | null>(null);
  const [problem, setProblem] = useState<{ readonly id: number; readonly text: string } | null>(null);
  const announce = useCallback((text: string) => setNews({ id: ++messageId.current, text }), []);
  const reportProblem = useCallback((text: string) => setProblem({ id: ++messageId.current, text }), []);
  const { engine, status, view, canvasKey } = usePhotoEngine(canvasRef, asset, loadOriginal);
  useClippingWarningOnEngine(engine);
  useGrainSeed(engine, asset.id);
  useEditSizes(engine, view, status.kind === 'ready');
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
  // While Crop is open, a fitted photo leaves room under it for Crop's options.
  const [cropRoom, setCropRoom] = useState(0);
  useEffect(() => {
    engine?.setFitInsets(isCropping && cropRoom > 0 ? { ...NO_INSETS, bottom: cropRoom } : NO_INSETS);
  }, [engine, isCropping, cropRoom]);
  const cropButtonRef = useRef<HTMLButtonElement>(null);
  useFocusReturn(isCropping, cropButtonRef);
  const isReady = status.kind === 'ready';
  const canEdit = isReady;
  const isBefore = isBeforeToggled || isBeforeHeld;
  useFocusKept(isBefore);
  // The sections whose eye is off: the photo is shown without them, and the
  // edit keeps them. For this photo and version only.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_SECTIONS);
  // The masks whose eye is off, by area ID: the same, for masks.
  const [hiddenMasks, setHiddenMasks] = useState<ReadonlySet<string>>(NO_SECTIONS);
  useEffect(() => {
    setHidden(NO_SECTIONS);
    setHiddenMasks(NO_SECTIONS);
  }, [asset.id, version.id]);
  const hideOf = (id: string): SectionHide => ({
    isHidden: hidden.has(id),
    isDisabled: !canEdit || isBefore,
    onToggle: () => {
      // The picker sets what is about to be hidden.
      if (id === 'whiteBalance') setIsPickingWb(false);
      setHidden((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
  });
  const savedRecipe = committed?.base === version.recipe ? applyChanges(version.recipe, committed.changes) : version.recipe;
  // A hidden mask that is gone (deleted, or its adding undone) hides nothing.
  const hiddenMaskTitles = liveAreas(savedRecipe).flatMap((area, i) => (hiddenMasks.has(area.id) ? [areaLabel(area, i)] : []));
  const hiddenSectionTitles = SECTIONS.filter((section) => hidden.has(section.id)).map((section) => section.title);
  const hiddenTitles = [...hiddenSectionTitles, ...hiddenMaskTitles];
  const hiddenNoun = hiddenMaskTitles.length === 0 ? 'sections' : hiddenSectionTitles.length === 0 ? 'masks' : 'edits';
  const withoutLabel = hiddenTitles.length > 2 ? `Without ${hiddenTitles.length} ${hiddenNoun}` : `Without ${hiddenTitles.join(' and ')}`;
  const isAnythingHidden = hiddenTitles.length > 0;
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
  useAltDragViews(engine, draft);
  useEffect(() => {
    engine?.setInteractive(isDraggingCheapControl);
  }, [engine, isDraggingCheapControl]);

  /** What the canvas shows: the edit (with a hovered preset) less the sections and masks hidden by their eyes, or Before. */
  const engineRecipe = useMemo(
    () => (isBefore ? beforeRecipe(displayedRecipe) : withoutAreas(withoutSections(displayedRecipe, hidden), hiddenMasks)),
    [isBefore, displayedRecipe, hidden, hiddenMasks],
  );
  useEffect(() => {
    engine?.setRecipe(engineRecipe);
  }, [engine, engineRecipe]);

  // ---- previews ------------------------------------------------------

  const { refreshPreviews } = usePreviews(engine, version, savedRecipe, isReady && !draft && !isBefore && !isAnythingHidden, onPreviewRendered);

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

  /** Another photo from the filmstrip, once this one's previews show its edit. */
  const openFromStrip = useCallback(
    (id: string) => {
      if (!filmstrip) return;
      const open = () => filmstrip.onOpen(id);
      if (isReady) void refreshPreviews(savedRecipe).finally(open);
      else open();
    },
    [filmstrip, isReady, refreshPreviews, savedRecipe],
  );

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

  // Read once this photo is ready, and forgotten while another loads, so a
  // RAW's Kelvin scale is never stood in for by the last photo's answer.
  const [photoInfoFor, setPhotoInfoFor] = useState<{ readonly assetId: string; readonly info: PhotoInfo } | null>(null);
  useEffect(() => {
    setPhotoInfoFor(engine && canEdit ? { assetId: asset.id, info: engine.photoInfo() } : null);
  }, [engine, canEdit, status.kind, asset.id]);
  const photoInfo = photoInfoFor?.assetId === asset.id ? photoInfoFor.info : null;

  const [histogram, setHistogram] = useState<{ readonly bins: Uint32Array; readonly hdrWhiteBin: number | null } | null>(null);
  // With the HDR view on an HDR canvas the histogram draws the HDR rendering, white marked; otherwise the ordinary one.
  const engineStatus = useSyncExternalStore(onStatusChange, currentStatus);
  const isHdrHistogram = showsHdr(engineStatus);
  // One histogram read in flight at most: commits that land while one is out are read once, after it.
  const histogramReads = useRef<CoalescedReads | null>(null);
  useEffect(() => {
    if (!engine || !canEdit || draft) return;
    let isCancelled = false;
    const reads = (histogramReads.current ??= new CoalescedReads());
    const timer = setTimeout(() => {
      reads.request(async () => {
        // A newer state's read has replaced this one; nothing to read for it.
        if (isCancelled) return;
        try {
          const bins = await (isHdrHistogram ? engine.readHdrHistogram() : engine.readHistogram());
          if (!isCancelled && bins) setHistogram({ bins, hdrWhiteBin: isHdrHistogram ? engine.hdrWhiteBin() : null });
        } catch (err) {
          console.warn('Photonamous: the histogram could not be read', err);
        }
      });
    }, HISTOGRAM_DELAY_MS);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [engine, canEdit, status.kind, shownRecipe, isBefore, hidden, hiddenMasks, draft, isHdrHistogram]);

  const handleAutoTone = useCallback(async () => {
    if (!engine) return;
    try {
      const tone = await engine.autoTone(savedRecipe);
      commit(toneChanges(savedRecipe, tone), 'Auto tone');
    } catch (err) {
      console.error('Photonamous: Auto tone failed', err);
      reportProblem('Auto could not set the tone.');
    } finally {
      engine.setRecipe(engineRecipe);
    }
  }, [engine, savedRecipe, engineRecipe, commit, reportProblem]);

  const autoWhiteBalance = photoInfo?.autoWhiteBalance ?? null;
  const whiteBalancePresets = useMemo(() => photoInfo?.whiteBalancePresets ?? [], [photoInfo]);
  const kelvinReadout = photoInfo?.kelvin ?? null;
  // Kelvin may depend on Tint too (measured Kelvin): the readout is the shown recipe's.
  const shownTint = shownRecipe.whiteBalance.tint;
  const temperatureDisplay = useMemo(() => (kelvinReadout ? kelvinDisplay(kelvinReadout, shownTint) : null), [kelvinReadout, shownTint]);
  const temperatureDisplays = useMemo(
    () => (temperatureDisplay ? { 'whiteBalance.temperature': temperatureDisplay } : null),
    [temperatureDisplay],
  );
  const isWhiteBalancePending = isWhiteBalanceWaiting(asset.format, photoInfo !== null);
  // On RAW, Temperature's history step reads in Kelvin, as its readout does.
  const handleWhiteBalanceCommit = useCallback(
    (control: ControlDef, value: number) => {
      if (control.path === 'whiteBalance.temperature' && temperatureDisplay) {
        commit(sliderChanges(control.path, value), `Temperature ${temperatureDisplay.format(value)}`);
      } else {
        handleSliderCommit(control, value);
      }
    },
    [commit, handleSliderCommit, temperatureDisplay],
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
      announce('White balance set from the picked spot.');
    },
    [engine, commit, announce],
  );

  const handleProfile = useCallback(
    (profile: DevelopProfile) => {
      if (profile.id !== savedRecipe.profile.id) commit({ 'profile.id': profile.id }, `Profile: ${profile.name}`);
    },
    [commit, savedRecipe.profile.id],
  );

  // ---- undo and redo -------------------------------------------------

  // Undo and Redo say what they did: by keyboard nothing else on screen speaks.
  const handleUndo = () => {
    const step = history ? stepToUndo(history) : null;
    onUndo();
    if (history) announce(step ? `Undone: ${step.label}` : 'Nothing to undo');
  };

  const handleRedo = () => {
    const step = history ? stepToRedo(history) : null;
    onRedo();
    if (history) announce(step ? `Redone: ${step.label}` : 'Nothing to redo');
  };

  // ---- keyboard ------------------------------------------------------

  const handleCopyPaste = (which: 'copyEdits' | 'pasteEdits') => {
    if (!canEdit || isCropping) return;
    if (which === 'copyEdits') {
      if (onCopyEdits) setIsCopyDialogOpen(true);
    } else onPasteEdits?.();
  };
  // Set once the tools below are defined; the key handler reads it.
  const toolShortcuts = useRef<(shortcut: 'crop' | 'linearArea' | 'radialArea' | 'showMask') => void>(() => undefined);
  const isToolOpen = isCropping || isLevelling || isPickingWb || isCopyDialogOpen || isHelpOpen;
  const handlers = useRef({ onUndo: handleUndo, onRedo: handleRedo, engine, filmstrip, isCropping: false, onCopyPaste: handleCopyPaste, isToolOpen, leave: () => {}, openFromStrip });
  handlers.current = { onUndo: handleUndo, onRedo: handleRedo, engine, filmstrip, isCropping, onCopyPaste: handleCopyPaste, isToolOpen, leave: () => void handleClose(), openFromStrip };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFieldKey(e.key, e.target) || e.defaultPrevented) return;
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      const h = handlers.current;
      if (shortcut === 'previous' || shortcut === 'next') {
        const strip = h.filmstrip;
        if (!strip || h.isCropping) return;
        const next = neighbourId(strip.items.map((i) => i.id), strip.currentId, shortcut === 'next' ? 1 : -1);
        if (!next) return;
        e.preventDefault();
        h.openFromStrip(next);
        return;
      }
      if (shortcut === 'crop' || shortcut === 'linearArea' || shortcut === 'radialArea' || shortcut === 'showMask') {
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
    if (!isCommit || !draftRect) {
      announce('Crop cancelled');
      return;
    }
    const next = recipeCrop(draftRect, effectiveFraming(savedRecipe.framing));
    if (JSON.stringify(next) === JSON.stringify(savedRecipe.framing.crop)) {
      announce('Crop unchanged');
      return;
    }
    commit({ 'framing.crop': next as Json }, 'Crop');
    announce('Cropped');
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
  const cropBox = fullSize && cropImageBox ? { size: fullSize, box: cropImageBox } : null;

  // ---- straighten -----------------------------------------------------

  const hasFlipV = 'flipV' in DEFAULT_RECIPE.framing;
  const handleLevelLine = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    setIsLevelling(false);
    const delta = levelAngle(a, b);
    if (delta === 0) return;
    const angle = Math.round(Math.max(-45, Math.min(45, framingAngle(savedRecipe.framing) + delta)) * 100) / 100;
    const label = changeLabel('Straighten', 'framing.angle', angle);
    commit({ 'framing.angle': angle }, label);
    announce(label);
  };

  // ---- masks (areas in the recipe) -------------------------------------

  /** The panel open beside the toolbar: the edit controls, the masks, or none (the photo has the room). */
  const [openPanel, setOpenPanel] = useState<'edit' | 'mask' | null>('edit');
  const isAreasOpen = openPanel === 'mask';
  const sections = useOpenSections();
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus for the Mask panel once it has rendered: a new mask's heading, or (null) its first way to add one.
  const [areaFocus, setAreaFocus] = useState<{ readonly id: string | null } | null>(null);
  useEffect(() => {
    if (!areaFocus) return;
    const panel = panelRef.current;
    const target =
      areaFocus.id === null
        ? panel?.querySelector<HTMLElement>('[data-area-add]')
        : panel?.querySelector<HTMLElement>(`[data-area-id="${CSS.escape(areaFocus.id)}"]`);
    target?.focus();
    setAreaFocus(null);
  }, [areaFocus]);
  const shownAreas = liveAreas(shownRecipe);
  const selectedArea = isAreasOpen ? shownAreas.find((a) => a.id === selectedAreaId) ?? null : null;
  const labelOfArea = (id: string) => {
    const index = shownAreas.findIndex((a) => a.id === id);
    const area = shownAreas[index];
    return area ? areaLabel(area, index) : 'Mask';
  };

  // The selected mask in red: with Show mask on, or while its shape changes and a moment after (mask-overlay.ts).
  const [isMaskShown, setIsMaskShown] = useState(false);
  // A mask hidden by its eye is not in what the engine shows, so it has nothing to show in red.
  const overlayAreaId = selectedArea && !hiddenMasks.has(selectedArea.id) ? selectedArea.id : null;
  const { flash: flashMask, endFlash: endMaskFlash } = useMaskOverlay(engine, overlayAreaId, isMaskShown, draft);
  const showMask = (isShown: boolean) => {
    setIsMaskShown(isShown);
    endMaskFlash();
  };
  const draftShape = (id: string, geometry: LinearGeometry | RadialGeometry) => {
    setDraft({ [`areas.${id}.geometry`]: { ...geometry } });
    flashMask();
  };
  const commitShape = (id: string, geometry: LinearGeometry | RadialGeometry, label: string) => {
    commit({ [`areas.${id}.geometry`]: { ...geometry } }, label);
    flashMask();
  };

  const handleAddArea = (kind: AreaKind) => {
    const id = newId();
    const added = addArea(savedRecipe, kind, id);
    if (!added) return;
    commit(added.values, kind === 'linear' ? 'Add linear mask' : 'Add radial mask');
    setSelectedAreaId(id);
    setAreaFocus({ id });
  };

  const handleDuplicateArea = (sourceId: string) => {
    const id = newId();
    const copied = duplicateArea(savedRecipe, sourceId, id);
    if (!copied) return;
    commit(copied.values, `Duplicate ${labelOfArea(sourceId)}`);
    setSelectedAreaId(id);
    setAreaFocus({ id });
  };

  const toggleAreas = () => {
    const isOpening = !isAreasOpen;
    setOpenPanel(isOpening ? 'mask' : null);
    if (isOpening) setAreaFocus({ id: null });
  };
  /** A toolbar button: its panel opens in place of the one that was open, or closes if it was the open one. */
  const selectTool = (id: string) => {
    if (id === 'mask') toggleAreas();
    else setOpenPanel((open) => (open === 'edit' ? null : 'edit'));
  };

  toolShortcuts.current = (shortcut) => {
    if (!canEdit || isBefore) return;
    if (shortcut === 'crop') {
      if (isCropping) finishCrop(true);
      else startCrop();
      return;
    }
    if (isCropping) return;
    if (shortcut === 'showMask') {
      if (isAreasOpen) showMask(!isMaskShown);
      return;
    }
    setOpenPanel('mask');
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
        onDraft={(geometry) => draftShape(selectedArea.id, geometry)}
        onCommit={(geometry, label) => commitShape(selectedArea.id, geometry, label)}
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

  const handleStageKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !engine || !canEdit) return;
    const action = stageKeyAction(e);
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'pan') engine.panBy(action.dx, action.dy);
    else engine.setZoom(engine.getView().zoom * action.factor);
  };

  // ---- pixel readout ---------------------------------------------------

  const pixel = usePixelReadout((clientX, clientY) => {
    const stage = stageRef.current;
    const size = engine?.imageSize() ?? null;
    const box = boxOf(size);
    if (!stage || !engine || !size || !box || !canEdit) return Promise.resolve(null);
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
    const fileName = `${baseName(asset.fileName)}.jpg`;
    setIsBusy(true);
    announce(`Exporting ${fileName}…`);
    try {
      const blob = await engine.exportImage({ format: 'jpeg', quality: 0.92, recipe: savedRecipe });
      onExport(blob, fileName);
      announce(`Exported ${fileName}`);
    } catch (err) {
      console.error('Photonamous: export failed', err);
      reportProblem(`${fileName} could not be exported: ${errorText(err)}`);
    } finally {
      setIsBusy(false);
    }
  };

  /** A renderer of `recipe` as a full-size 16-bit PNG, for Edit in Lopsy and Done. */
  const fullPng16 = (recipe: Recipe) => async (): Promise<ArrayBuffer> => {
    if (!engine) throw new Error('The editing engine is not running');
    const png = await engine.exportImage({ format: 'png', recipe });
    return png.arrayBuffer();
  };

  const handleEditInLopsy = () => {
    if (engine && onEditInLopsy && !isBusy) onEditInLopsy(fullPng16(savedRecipe));
  };

  // ---- left column ---------------------------------------------------

  const handleGoTo = (stepId: string) => {
    if (!history) return;
    const moves = movesTo(history, stepId);
    for (let i = 0; i < moves.undo; i++) onUndo();
    for (let i = 0; i < moves.redo; i++) onRedo();
    announce(`Went to ${history.find((s) => s.id === stepId)?.label ?? 'Original'}`);
  };

  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const leftSections: LeftColumnSection[] = [];
  if (versions && onSelectVersion) {
    leftSections.push({
      id: 'versions',
      title: 'Versions',
      icon: <Copy size={16} aria-hidden />,
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
      icon: <Wand2 size={16} aria-hidden />,
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
      icon: <History size={16} aria-hidden />,
      content: <HistoryPanel history={history} isDisabled={!canEdit || isCropping} onGoTo={handleGoTo} />,
    });
  }

  const handleDone = () => {
    if (engine && onDone && !isBusy) onDone(fullPng16(savedRecipe), savedRecipe);
  };

  const tools: EditTool[] = [
    { id: 'edit', label: 'Edit', title: 'Edit: light, colour, detail and finish', icon: <SlidersHorizontal size={16} aria-hidden /> },
    {
      id: 'mask',
      label: 'Mask',
      title: 'Mask: adjust part of the photo (M linear, ⇧M radial)',
      icon: <Spline size={16} aria-hidden />,
      isDisabled: !canEdit || isBefore || isCropping,
    },
  ];
  const toolbarActions: EditToolbarAction[] = onEditInLopsy
    ? [
        {
          id: 'lopsy',
          label: 'Edit in Lopsy',
          title: 'Edit in Lopsy, with layers, painting and text',
          icon: <Paintbrush size={16} aria-hidden />,
          isDisabled: !isReady,
          isBusy,
          onClick: handleEditInLopsy,
        },
      ]
    : [];

  const isAllDefault = recipeHash(beforeRecipe(savedRecipe)) === recipeHash(savedRecipe);
  // The zoom against the full image, whatever size the working image is.
  const workingScale = engine?.workingScale() ?? 1;
  const zoomPercent = view ? Math.round(view.zoom * workingScale * 100) : 100;
  const isLoadingFull = engine?.isLoadingFullResolution() ?? false;
  // Shown below its own size for this device's sake (its GPU's largest texture, or a full-size load that failed).
  const fullSizeNote = canEdit ? engine?.fullSizeNote() ?? null : null;
  const sizeNoteText = fullSizeNote ? fullSizeNoteText(fullSizeNote) : null;
  const photoLabel =
    status.kind === 'error'
      ? `${asset.fileName}, could not be opened`
      : !canEdit
        ? `${asset.fileName}, loading`
        : isBefore
          ? `${asset.fileName} without its edits (Before)`
          : isSplitShown
            ? `${asset.fileName}, before and after side by side`
            : hiddenTitles.length > 0
              ? `${asset.fileName}, shown ${withoutLabel.toLowerCase()}`
            : isAllDefault
              ? asset.fileName
              : `${asset.fileName}, edited`;

  // What changes by itself is said once (WCAG 4.1.3); slider drags say nothing here.
  const lastStatus = useRef(status.kind);
  useEffect(() => {
    if (status.kind === 'ready' && lastStatus.current !== 'ready') announce(`${asset.fileName} is ready to edit`);
    lastStatus.current = status.kind;
  }, [status.kind, asset.fileName, announce]);

  const wasLoadingFull = useRef(false);
  // The size note is said once for each photo; the load's end says it in place of "Full resolution loaded".
  const saidSizeNote = useRef<string | null>(null);
  useEffect(() => {
    if (isLoadingFull && !wasLoadingFull.current) announce('Loading full resolution…');
    else if (!isLoadingFull && wasLoadingFull.current) {
      announce(sizeNoteText ?? 'Full resolution loaded');
      if (sizeNoteText) saidSizeNote.current = sizeNoteText;
    }
    wasLoadingFull.current = isLoadingFull;
  }, [isLoadingFull, announce, sizeNoteText]);

  useEffect(() => {
    if (sizeNoteText && saidSizeNote.current !== sizeNoteText) announce(sizeNoteText);
    saidSizeNote.current = sizeNoteText;
  }, [sizeNoteText, announce]);

  useEffect(() => {
    if (isPickingWb) announce('Click something in the photo that should be neutral grey, or press Escape. Temperature and Tint set the white balance by keyboard.');
  }, [isPickingWb, announce]);

  useEffect(() => {
    if (isLevelling) announce('Draw along something in the photo that should be level, or press Escape. The Angle slider straightens by keyboard.');
  }, [isLevelling, announce]);

  useEffect(() => {
    setProblem(null);
  }, [asset.id]);

  // Alone on the page its bar of tools is the page's header; under the app's header it is a named section, so there is one banner.
  const Bar = isUnderAppHeader ? 'section' : 'header';

  return (
    <div className={styles.editView} data-testid="edit-view" data-status={status.kind}>
      <Bar className={styles.toolbar} aria-label={isUnderAppHeader ? 'Photo and tools' : undefined}>
        <button type="button" className={styles.toolButton} onClick={() => void handleClose()} aria-disabled={isBusy || undefined}>
          <ArrowLeft size={16} aria-hidden />
          <span>{closeLabel}</span>
        </button>
        {leftSections.length > 0 && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={isLeftOpen ? 'Hide the left column' : 'Show the left column'}
            title={isLeftOpen ? 'Hide presets, versions and history' : 'Show presets, versions and history'}
            onClick={() => setIsLeftOpen((v) => !v)}
          >
            {isLeftOpen ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
          </button>
        )}
        <h1 ref={headingRef} className={styles.fileName} title={asset.fileName} tabIndex={-1}>
          {asset.fileName}
        </h1>
        {/* The tools, in groups with a line between them: clipping warnings, framing, undo and redo, then copy and paste edits. */}
        <ClippingButtons bins={histogram?.bins ?? null} isDisabled={!canEdit} isHdr={(histogram?.hdrWhiteBin ?? null) !== null} />
        <span className={styles.toolDivider} aria-hidden data-testid="tool-divider" />
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate left"
            title="Rotate left"
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, false), 'Rotate left')}
          >
            <RotateCcwSquare size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate right"
            title="Rotate right"
            disabled={!canEdit || isBefore || isCropping}
            onClick={() => onSetRecipe(rotateRecipe(savedRecipe, true), 'Rotate right')}
          >
            <RotateCwSquare size={16} aria-hidden />
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
            ref={cropButtonRef}
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
        </div>
        <span className={styles.toolDivider} aria-hidden data-testid="tool-divider" />
        <div className={styles.toolGroup}>
          <button type="button" className={styles.iconButton} aria-label="Undo" title="Undo (⌘Z)" aria-keyshortcuts="Meta+Z Control+Z" onClick={handleUndo}>
            <Undo2 size={16} aria-hidden />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Redo" title="Redo (⇧⌘Z)" aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z" onClick={handleRedo}>
            <Redo2 size={16} aria-hidden />
          </button>
        </div>
        {(onCopyEdits || onPasteEdits) && (
          <>
            <span className={styles.toolDivider} aria-hidden data-testid="tool-divider" />
            <div className={styles.toolGroup}>
              {onCopyEdits && (
                <button type="button" className={styles.iconButton} aria-label="Copy edits" title="Copy edits (⇧⌘C)" disabled={!canEdit || isCropping} onClick={() => handleCopyPaste('copyEdits')}>
                  <ClipboardCopy size={16} aria-hidden />
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
          </>
        )}
        {onDone && (
          <button type="button" className={styles.primaryButton} onClick={handleDone} disabled={!isReady} aria-disabled={isBusy || undefined}>
            <Check size={16} aria-hidden />
            <span>Done</span>
          </button>
        )}
        {onExport && (
          <button type="button" className={styles.primaryButton} onClick={() => void handleExport()} disabled={!isReady} aria-disabled={isBusy || undefined}>
            <Download size={16} aria-hidden />
            <span>Export</span>
          </button>
        )}
      </Bar>
      <div className={styles.body}>
        <LeftColumn sections={leftSections} isOpen={isLeftOpen} onOpen={() => setIsLeftOpen(true)} />
        <main className={styles.main}>
          <div
            ref={stageRef}
            className={styles.stage}
            tabIndex={0}
            role="group"
            aria-label="Photo"
            aria-describedby={stageHintId}
            onKeyDown={handleStageKeyDown}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
            onPointerCancel={handleStagePointerUp}
            onPointerLeave={pixel.onPointerLeave}
          >
            <canvas key={canvasKey} ref={canvasRef} className={styles.canvas} role="img" aria-label={photoLabel} data-testid="edit-canvas" />
            {storedPreviewUrl && !canEdit && status.kind !== 'error' && (
              <img className={styles.storedPreview} src={storedPreviewUrl} alt="" data-testid="stored-preview" draggable={false} />
            )}
            {(isLoadingFull || (storedPreviewUrl && !canEdit && status.kind !== 'error')) && (
              <span className={styles.loadingBadge} data-testid="loading-badge">
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
              <span className={styles.pixelReadout} data-testid="pixel-readout">
                R {pixel.readout[0]} G {pixel.readout[1]} B {pixel.readout[2]}
              </span>
            )}
            {splitBox && <SplitView imageBox={splitBox} beforeSrc={beforeSrc} at={splitAt} onChange={setSplitAt} />}
            {cropDraft && cropBox && (
              <CropTool
                imageBox={cropBox.box}
                imageSize={cropBox.size}
                rect={cropDraft}
                onChange={setCropDraft}
                onDone={() => finishCrop(true)}
                onCancel={() => finishCrop(false)}
                onBarRoom={setCropRoom}
              />
            )}
            {isBefore && canEdit && <span className={styles.beforeBadge}>Before</span>}
            {!isBefore && canEdit && hiddenTitles.length > 0 && (
              <span className={styles.beforeBadge} data-testid="hidden-badge">
                {withoutLabel}
              </span>
            )}
            {!(storedPreviewUrl && status.kind !== 'error' && !canEdit) && <LoadStatus status={status} onClose={onClose} closeLabel={closeLabel} />}
            {problem && (
              <div key={problem.id} className={styles.problem} role="alert" data-testid="edit-problem">
                <span>{problem.text}</span>
                <button type="button" className={styles.iconButton} aria-label="Dismiss" onClick={() => setProblem(null)}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            )}
          </div>
          <div className={styles.stageBar} role="group" aria-label="View">
            <div className={styles.toolGroup}>
              <ZoomField
                zoom={view ? view.zoom * workingScale : 1}
                onZoom={(next) => engine?.setZoom(next / workingScale)}
                isDisabled={!canEdit}
                hint={view?.isFit ? 'Zoom: the whole photo fits. Type a level from 10 to 400% and press Enter' : "Zoom, of the photo's full size. Type a level from 10 to 400% and press Enter"}
                data-testid="zoom-readout"
              />
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={view?.isFit ?? true}
                title="Fit the whole photo in the window"
                onClick={() => engine?.fit()}
                disabled={!canEdit}
              >
                Fit
              </button>
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={!view?.isFit && zoomPercent === 100}
                title="Full size: one pixel of the photo to one pixel of the screen (100%)"
                onClick={() => engine?.setZoom(1 / workingScale)}
                disabled={!canEdit}
              >
                Full
              </button>
            </div>
            <div className={styles.toolGroup}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Before"
                aria-pressed={isBeforeToggled}
                title="Before and after (hold \)"
                onClick={() => setIsBeforeToggled((v) => !v)}
                disabled={!canEdit}
              >
                <Eye size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Split"
                aria-pressed={isSplit}
                title="Before and after side by side"
                onClick={() => setIsSplit((v) => !v)}
                disabled={!canEdit || isCropping}
              >
                <SplitSquareHorizontal size={16} aria-hidden />
              </button>
            </div>
          </div>
          {sizeNoteText && (
            <p className={styles.sizeNote} data-testid="size-note">
              {sizeNoteText}
            </p>
          )}
          <p id={stageHintId} className={styles.srOnly}>
            Arrow keys move a zoomed photo, Shift by more; plus and minus zoom in and out.
          </p>
          <p className={styles.srOnly} role="status" data-testid="edit-status">
            {news && <span key={news.id}>{news.text}</span>}
          </p>
        </main>
        {/* One landmark for the toolbar and the panel it opens. */}
        <aside className={styles.side} aria-label="Edits">
        {openPanel !== null && (
        <div ref={panelRef} className={styles.panel} data-testid="edit-panel" data-panel={openPanel}>
          <Histogram bins={histogram?.bins ?? null} hdrWhiteBin={histogram?.hdrWhiteBin ?? null} />
          {isAreasOpen && (
            <MaskPanel
              recipe={shownRecipe}
              selectedId={selectedAreaId}
              isDisabled={!canEdit || isBefore || isCropping}
              onAdd={handleAddArea}
              onDuplicate={handleDuplicateArea}
              onSelect={setSelectedAreaId}
              onRename={(id, name) => commit({ [`areas.${id}.name`]: name }, 'Rename mask')}
              onInvert={(id, isInverted) => {
                commit({ [`areas.${id}.invert`]: isInverted }, `${labelOfArea(id)} ${isInverted ? 'inverted' : 'not inverted'}`);
                // Inverting changes what the mask covers: the selected one shows for a moment, as after a change of shape.
                if (id === selectedArea?.id) flashMask();
              }}
              onDelete={(id) => {
                commit(removeArea(id), `Delete ${labelOfArea(id)}`);
                if (selectedAreaId === id) setSelectedAreaId(null);
              }}
              onChange={(control, value) => {
                endMaskFlash();
                handleSliderChange(control, value);
              }}
              onCommit={handleSliderCommit}
              onDraftChanges={(changes) => {
                endMaskFlash();
                setDraft(changes);
              }}
              onCommitChanges={commit}
              hiddenIds={hiddenMasks}
              onToggleHidden={(id) =>
                setHiddenMasks((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })
              }
              isHideDisabled={!canEdit || isBefore}
              shapeFrame={areaFrame && docSize ? { frame: areaFrame, doc: docSize } : null}
              onShapeChange={draftShape}
              onShapeCommit={commitShape}
            />
          )}
          {openPanel === 'edit' && (
          <>
          {photoInfo && (
            <ProfileMenu
              profiles={photoInfo.profiles}
              profileId={shownRecipe.profile.id}
              isDisabled={!canEdit || isBefore}
              onSelect={handleProfile}
              note={photoInfo.colorNote}
            />
          )}
          {FRAMING_GROUP && (
            <ControlGroup
              group={FRAMING_GROUP}
              isOpen={sections.isOpen(FRAMING_GROUP.id)}
              onToggle={() => sections.toggle(FRAMING_GROUP?.id ?? 'framing')}
              recipe={shownRecipe}
              isDisabled={!canEdit || isBefore || isCropping}
              onChange={handleSliderChange}
              onCommit={handleSliderCommit}
              onReset={handleGroupReset}
              onAuto={() => setIsLevelling((v) => !v)}
              autoLabel={isLevelling ? 'Cancel' : 'Level'}
              autoTitle="Draw along something in the photo that should be level; the Angle slider straightens by keyboard"
            />
          )}
          {GROUPS.map((group) => (
            <Fragment key={group.id}>
            <ControlGroup
              group={group}
              isOpen={sections.isOpen(group.id)}
              onToggle={() => sections.toggle(group.id)}
              hide={hideOf(group.id)}
              recipe={shownRecipe}
              isDisabled={!canEdit || isBefore || hidden.has(group.id) || (group.id === 'whiteBalance' && isWhiteBalancePending)}
              {...(group.id === 'whiteBalance' && canEdit && isWhiteBalancePending ? { note: 'Reading the camera’s white balance…' } : {})}
              onChange={handleSliderChange}
              onCommit={group.id === 'whiteBalance' ? handleWhiteBalanceCommit : handleSliderCommit}
              onReset={handleGroupReset}
              {...(group.id === 'tone'
                ? {
                    onAuto: () => void handleAutoTone(),
                    autoTitle: canEdit ? 'Set the tone controls from the histogram' : 'Auto is ready once the photo has loaded',
                  }
                : {})}
              {...(group.id === 'whiteBalance' && temperatureDisplays ? { displays: temperatureDisplays } : {})}
            >
              {group.id === 'whiteBalance' && (
                <WhiteBalanceMenu
                  recipe={shownRecipe}
                  auto={autoWhiteBalance}
                  presets={whiteBalancePresets}
                  isDisabled={!canEdit || isBefore || isWhiteBalancePending || hidden.has('whiteBalance')}
                  onCommit={commit}
                  isPicking={isPickingWb}
                  onTogglePicker={() => setIsPickingWb((v) => !v)}
                />
              )}
            </ControlGroup>
            {group.id === 'tone' && (
              <CurvesGroup
                isOpen={sections.isOpen('curves')}
                onToggle={() => sections.toggle('curves')}
                hide={hideOf('curves')}
                recipe={shownRecipe}
                isDisabled={!canEdit || isBefore || hidden.has('curves')}
                onDraft={setDraft}
                onCommit={commit}
              />
            )}
            {group.id === 'color' && (
              <>
                <TabbedGroup
                  title="Color by hue"
                  isOpen={sections.isOpen('colorByHue')}
                  onToggle={() => sections.toggle('colorByHue')}
                  hide={hideOf('colorByHue')}
                  tabs={COLOR_BY_HUE_TABS}
                  recipe={shownRecipe}
                  isDisabled={!canEdit || isBefore || hidden.has('colorByHue')}
                  onChange={handleSliderChange}
                  onCommit={handleSliderCommit}
                  onReset={commit}
                />
                <TabbedGroup
                  title="Color Grading"
                  isOpen={sections.isOpen('colorGrading')}
                  onToggle={() => sections.toggle('colorGrading')}
                  tabs={COLOR_GRADING_TABS}
                  sharedControls={COLOR_GRADING_SHARED}
                  hide={hideOf('colorGrading')}
                  recipe={shownRecipe}
                  isDisabled={!canEdit || isBefore || hidden.has('colorGrading')}
                  onChange={handleSliderChange}
                  onCommit={handleSliderCommit}
                  onReset={commit}
                  onFieldChange={setDraft}
                  onFieldCommit={commit}
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
          </>
          )}
        </div>
        )}
        <EditToolbar tools={tools} activeId={openPanel} onSelect={selectTool} actions={toolbarActions} />
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
      {filmstrip && <Filmstrip items={filmstrip.items} currentId={filmstrip.currentId} onOpen={openFromStrip} />}
    </div>
  );
}
