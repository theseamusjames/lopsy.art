/**
 * WASM Bridge — typed wrappers around all wasm_bindgen exports.
 * This is the sole import point for the WASM module.
 */

import init, {
  Engine,
  snapshotLayerGpu,
  snapshotMaskGpu,
  restoreMaskFromGpuSnapshot as rawRestoreMaskFromGpuSnapshot,
  beginMaskFilterTarget,
  endMaskFilterTarget as rawEndMaskFilterTarget,
  restoreFromGpuSnapshot,
  releaseGpuSnapshot,
  clearGpuSnapshots,
  liveGpuSnapshotCount,
  effectCacheStats,
  loseGpuDevice,
  rendererName,
  createEngine,
  setDocumentSize,
  setViewport,
  setBackgroundColor,
  setDocumentColorMode,
  convertLayerToGrayscale,
  quantizeCompositeToPalette as rawQuantizeCompositeToPalette,
  applyPaletteToLayer as rawApplyPaletteToLayer,
  convertLayerToLab as rawConvertLayerToLab,
  convertLayerFromLab as rawConvertLayerFromLab,
  bakeCmykGamut as rawBakeCmykGamut,
  addLayer,
  removeLayer,
  updateLayer,
  setLayerOrder,
  uploadLayerPixels,
  flattenIntoLayer as rawFlattenIntoLayer,
  uploadLayerPixelsFromCanvas,
  readLayerPixels as rawReadLayerPixels,
  decodeAndUploadImage,
  decodeAndUploadDng,
  rafPlanBands,
  uploadLayerPixelsF32Rect,
  uploadLayerSparsePixels,
  uploadLayerMask as rawUploadLayerMask,
  removeLayerMask as rawRemoveLayerMask,
  getLayerTextureDimensions,
  layerContentGeneration,
  getLayerEngineBounds,
  getLayerContentBounds as rawGetLayerContentBounds,
  uploadLayerPixelsCompressed,
  readLayerPixelsLz4U16 as rawReadLayerPixelsLz4U16,
  uploadLayerPixelsCompressedU16,
  readLayerThumbnail as rawReadLayerThumbnail,
  readCompositeThumbnail as rawReadCompositeThumbnail,
  bakeLayerEffects as rawBakeLayerEffects,
  duplicateLayerTexture,
  mergeLayers,
  flipLayer,
  clipboardCopy,
  clipboardCopyMerged as rawClipboardCopyMerged,
  clipboardCut,
  clipboardPaste,
  clearSelectedPixels,
  readClipboardPixels as rawReadClipboardPixels,
  uploadClipboardPixels,
  beginStroke,
  prewarmStroke,
  applyBrushDab,
  applyBrushDabBatch,
  compositePatchOntoLayer,
  applyEraserDab,
  applyEraserDabBatch,
  drawPencilLine,
  endStroke,
  generateBrushStamp,
  interpolatePoints,
  beginDodgeBurnStroke,
  applyDodgeBurnDabBatch,
  endDodgeBurnStroke,
  beginSpongeStroke,
  applySpongeDabBatch,
  endSpongeStroke,
  applySmudgeDab,
  applySmudgeDabBatch,
  applyStampDab,
  applyStampDabBatch,
  applyHealingDab,
  applyHealingDabBatch,
  renderLinearGradient,
  renderRadialGradient,
  saveGradientPreview,
  endGradientPreview,
  interpolateGradient,
  computeLinearGradientT,
  computeRadialGradientT,
  sampleColor as rawSampleColor,
  saveShapePreview,
  endShapePreview,
  renderShape,
  renderShapeExpanded,
  uploadPathTexture,
  render,
  markAllDirty,
  setImageExposure,
  setImageContrast,
  setImageHighlights,
  setImageShadows,
  setImageWhites,
  setImageBlacks,
  setImageVignette,
  setImageSaturation,
  setImageVibrance,
  setImageCurvesLut,
  clearImageCurves,
  setImageLevelsLut,
  clearImageLevels,
  clearImageAdjustments,
  setImageInvert,
  setImageHueSaturation,
  setImageColorBalance,
  setImagePhotoFilter,
  setImageBlackWhite,
  clearImageBlackWhite,
  setImageChannelMixer,
  clearImageChannelMixer,
  setImageGradientMapLut,
  clearImageGradientMap,
  setGroupAdjustments,
  setGroupCurvesLut,
  setGroupLevelsLut,
  clearGroupAdjustments,
  removeGroupAdjustment,
  setGroupInvert,
  setGroupHueSaturation,
  setGroupColorBalance,
  setGroupColorGrading,
  setGroupPhotoFilter,
  setGroupBlackWhite,
  setGroupChannelMixer,
  setGroupGradientMapLut,
  blendColors,
  filterGaussianBlur,
  filterSurfaceBlur,
  filterBoxBlur,
  filterUnsharpMask,
  filterBrightnessContrast,
  filterHueSaturation,
  filterInvert,
  filterDesaturate,
  filterPosterize,
  filterThreshold,
  filterAddNoise,
  filterMotionBlur,
  filterRadialBlur,
  filterFindEdges,
  filterCelShading,
  filterClouds,
  filterFibers,
  filterSunburst,
  filterTexture,
  filterSmoke,
  filterPixelate,
  filterHalftone,
  filterSolarize,
  filterKaleidoscope,
  filterOilPaint,
  filterChromaticAberration,
  filterPixelStretch,
  filterLensDistortion,
  filterEmboss,
  filterBloom,
  filterVoronoi,
  filterPatternFill,
  filterColorLut,
  readChannelThumbnail as rawReadChannelThumbnail,
  filterMeshWarp,
  liquifyInitDisplacement,
  liquifyRender,
  liquifyRelease,
  liquifyApplyDabGpu,
  filterTiltShiftBlur,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  setSelectionMask,
  featherSelectionMask,
  readSelectionMask as rawReadSelectionMask,
  clearSelection,
  createRectSelection,
  createEllipseSelection,
  invertSelection,
  combineSelections,
  selectionBounds,
  isEmptySelection,
  traceSelectionContours,
  getSelectionEdges,
  createPolygonMask,
  enterQuickMaskMode,
  exitQuickMaskMode as rawExitQuickMaskMode,
  paintQuickMaskDab,
  paintQuickMaskDabBatch,
  drawQuickMaskPencilLine,
  fillQuickMask as rawFillQuickMask,
  renderQuickMaskLinearGradient,
  renderQuickMaskRadialGradient,
  readQuickMaskPixels as rawReadQuickMaskPixels,
  resumeTask,
  uploadQuickMaskPixels,
  beginQuickMaskMove,
  translateQuickMask,
  endQuickMaskMove,
  paintMaskDab as rawPaintMaskDab,
  paintMaskDabBatch as rawPaintMaskDabBatch,
  drawMaskPencilLine as rawDrawMaskPencilLine,
  readMaskTexture as rawReadMaskTexture,
  fillMask as rawFillMask,
  remapLayerMask as rawRemapLayerMask,
  fillMaskWithValue as rawFillMaskWithValue,
  renderMaskLinearGradient as rawRenderMaskLinearGradient,
  renderMaskRadialGradient as rawRenderMaskRadialGradient,
  screenToCanvas,
  cropToContentBounds,
  expandFromCrop,
  toSparsePixelData,
  scalePixelData,
  resizeCanvasPixelData,
  cropLayerPixelData,
  floodFill,
  applyFillToLayer,
  readLayerPixelsForFill as rawReadLayerPixelsForFill,
  bucketFillSolid,
  bucketFillByColorGpu,
  magneticLassoBegin as rawMagneticLassoBegin,
  magneticLassoSnap,
  magneticLassoSnapPoint,
  magneticLassoEnd,
  detectColorSpace,
  compositeForExport as rawCompositeForExport,
  exportPng16 as rawExportPng16,
  buildIccProfile,
  convertP3ToSrgb,
  getCompositeSize,
  setGridVisible,
  setGridSize,
  setTransformOverlay,
  setGradientGuide,
  clearGradientGuide,
  setPathOverlay,
  setLassoPreview,
  setCropPreview,
  clearCropPreview,
  setBrushCursor,
  clearBrushCursor,
  setStampSourcePreview,
  clearStampSourcePreview,
  setRulersVisible,
  setSeamlessPattern,
  setChannelMask,
  floatSelection,
  restoreFloatBase,
  compositeFloat,
  compositeFloatAffine,
  compositeFloatPerspective,
  ensureFloatCovers,
  dropFloat,
  hasFloat,
  beginLayerTransform,
  prepareLayerTransformTarget,
  compositeLayerTransformAffine,
  compositeLayerTransformPerspective,
  hasLayerTransform,
  fillWithColor,
  fillLayerFrame,
  rotateLayer90,
  scaleLayerTexture,
  resizeCanvasTexture,
  cropLayerTexture,
  setMaskEditLayer,
  clearMaskEditLayer,
  uploadBrushTip,
  uploadBrushTipRGBA,
  clearBrushTip,
  setBrushTipState,
  setBrushDabTransform,
  cacheSubBrushTip,
  cacheSubBrushTipRGBA,
  activateSubBrushTip,
  deactivateSubBrushTip,
  clearSubBrushTipCache,
  getBuiltinBrushTip,
  listBuiltinBrushTips,
  uploadBrushTexture,
  clearBrushTexture,
  setBrushTextureState,
  clearAllLayers,
  exportPsd as rawExportPsd,
  parsePsd,
  decodeAndUploadPsdLayer,
  getPsdLayerMask,
  loadFontData as rawLoadFontData,
  loadFontDataForFamily as rawLoadFontDataForFamily,
  setTextLayerContent,
  renderTextLayer,
  renderTextLayerToTexture,
  renderTextLayerTransformed,
  textLayoutBounds,
  textRasterBounds,
  getRenderedTextPixels,
  getGlyphPositions,
  textHitPosition,
  textCursorRect,
  textSelectionRects,
  removeTextLayerState as rawRemoveTextLayerState,
  isFontLoaded,
  expandLayerToDocSize,
  cropLayerToContent,
  floodFillGraduated,
} from './pkg/lopsy_wasm';
import { markMaskGpuDirty } from './mask-gpu-dirty';
import { bumpTextLayoutGeneration } from './text-layout-generation';
import { WASM_INIT_TIMING, recordStartupTiming } from './startup-timing';

export type { Engine };

let initPromise: Promise<void> | null = null;
let initError: unknown = null;
let wasmMemory: WebAssembly.Memory | null = null;

export async function initWasm(): Promise<void> {
  if (initError) throw initError;
  if (!initPromise) {
    initPromise = init()
      .then((output: { memory: WebAssembly.Memory }) => {
        wasmMemory = output.memory;
        // From navigation start: the wasm fetch begins with the page.
        recordStartupTiming(WASM_INIT_TIMING, 0);
      })
      .catch((err: unknown) => {
        initError = err;
        initPromise = null;
        throw err;
      });
  }
  await initPromise;
}

export function getWasmMemoryBytes(): number {
  return wasmMemory ? wasmMemory.buffer.byteLength : 0;
}

// Re-export everything with the same names
export {
  snapshotLayerGpu,
  snapshotMaskGpu,
  beginMaskFilterTarget,
  restoreFromGpuSnapshot,
  releaseGpuSnapshot,
  clearGpuSnapshots,
  liveGpuSnapshotCount,
  effectCacheStats,
  loseGpuDevice,
  rendererName,
  createEngine,
  setDocumentSize,
  setViewport,
  setBackgroundColor,
  setDocumentColorMode,
  convertLayerToGrayscale,
  clearAllLayers,
  addLayer,
  removeLayer,
  updateLayer,
  setLayerOrder,
  uploadLayerPixels,
  uploadLayerPixelsFromCanvas,
  decodeAndUploadImage,
  decodeAndUploadDng,
  rafPlanBands,
  uploadLayerPixelsF32Rect,
  uploadLayerSparsePixels,
  getLayerTextureDimensions,
  layerContentGeneration,
  getLayerEngineBounds,
  uploadLayerPixelsCompressed,
  uploadLayerPixelsCompressedU16,
  duplicateLayerTexture,
  mergeLayers,
  flipLayer,
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  clearSelectedPixels,
  uploadClipboardPixels,
  beginStroke,
  prewarmStroke,
  applyBrushDab,
  applyBrushDabBatch,
  compositePatchOntoLayer,
  applyEraserDab,
  applyEraserDabBatch,
  drawPencilLine,
  endStroke,
  generateBrushStamp,
  interpolatePoints,
  beginDodgeBurnStroke,
  applyDodgeBurnDabBatch,
  endDodgeBurnStroke,
  beginSpongeStroke,
  applySpongeDabBatch,
  endSpongeStroke,
  applySmudgeDab,
  applySmudgeDabBatch,
  applyStampDab,
  applyStampDabBatch,
  applyHealingDab,
  applyHealingDabBatch,
  renderLinearGradient,
  renderRadialGradient,
  saveGradientPreview,
  endGradientPreview,
  interpolateGradient,
  computeLinearGradientT,
  computeRadialGradientT,
  saveShapePreview,
  endShapePreview,
  renderShape,
  renderShapeExpanded,
  uploadPathTexture,
  render,
  markAllDirty,
  setImageExposure,
  setImageContrast,
  setImageHighlights,
  setImageShadows,
  setImageWhites,
  setImageBlacks,
  setImageVignette,
  setImageSaturation,
  setImageVibrance,
  setImageCurvesLut,
  clearImageCurves,
  setImageLevelsLut,
  clearImageLevels,
  clearImageAdjustments,
  setImageInvert,
  setImageHueSaturation,
  setImageColorBalance,
  setImagePhotoFilter,
  setImageBlackWhite,
  clearImageBlackWhite,
  setImageChannelMixer,
  clearImageChannelMixer,
  setImageGradientMapLut,
  clearImageGradientMap,
  setGroupAdjustments,
  setGroupCurvesLut,
  setGroupLevelsLut,
  clearGroupAdjustments,
  removeGroupAdjustment,
  setGroupInvert,
  setGroupHueSaturation,
  setGroupColorBalance,
  setGroupColorGrading,
  setGroupPhotoFilter,
  setGroupBlackWhite,
  setGroupChannelMixer,
  setGroupGradientMapLut,
  blendColors,
  filterGaussianBlur,
  filterSurfaceBlur,
  filterBoxBlur,
  filterUnsharpMask,
  filterBrightnessContrast,
  filterHueSaturation,
  filterInvert,
  filterDesaturate,
  filterPosterize,
  filterThreshold,
  filterAddNoise,
  filterMotionBlur,
  filterRadialBlur,
  filterFindEdges,
  filterCelShading,
  filterClouds,
  filterFibers,
  filterSunburst,
  filterTexture,
  filterSmoke,
  filterPixelate,
  filterHalftone,
  filterSolarize,
  filterKaleidoscope,
  filterOilPaint,
  filterChromaticAberration,
  filterPixelStretch,
  filterLensDistortion,
  filterEmboss,
  filterBloom,
  filterVoronoi,
  filterPatternFill,
  filterColorLut,
  filterMeshWarp,
  liquifyInitDisplacement,
  liquifyRender,
  liquifyRelease,
  liquifyApplyDabGpu,
  filterTiltShiftBlur,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  setSelectionMask,
  featherSelectionMask,
  clearSelection,
  createRectSelection,
  createEllipseSelection,
  invertSelection,
  combineSelections,
  selectionBounds,
  isEmptySelection,
  traceSelectionContours,
  getSelectionEdges,
  createPolygonMask,
  enterQuickMaskMode,
  paintQuickMaskDab,
  paintQuickMaskDabBatch,
  drawQuickMaskPencilLine,
  renderQuickMaskLinearGradient,
  renderQuickMaskRadialGradient,
  uploadQuickMaskPixels,
  beginQuickMaskMove,
  translateQuickMask,
  endQuickMaskMove,
  screenToCanvas,
  cropToContentBounds,
  expandFromCrop,
  toSparsePixelData,
  scalePixelData,
  resizeCanvasPixelData,
  cropLayerPixelData,
  floodFill,
  applyFillToLayer,
  bucketFillSolid,
  bucketFillByColorGpu,
  magneticLassoSnap,
  magneticLassoSnapPoint,
  magneticLassoEnd,
  detectColorSpace,
  buildIccProfile,
  convertP3ToSrgb,
  getCompositeSize,
  setGridVisible,
  setGridSize,
  setTransformOverlay,
  setGradientGuide,
  clearGradientGuide,
  setPathOverlay,
  setLassoPreview,
  setCropPreview,
  clearCropPreview,
  setBrushCursor,
  clearBrushCursor,
  setStampSourcePreview,
  clearStampSourcePreview,
  setRulersVisible,
  setSeamlessPattern,
  setChannelMask,
  floatSelection,
  restoreFloatBase,
  compositeFloat,
  compositeFloatAffine,
  compositeFloatPerspective,
  ensureFloatCovers,
  dropFloat,
  hasFloat,
  beginLayerTransform,
  prepareLayerTransformTarget,
  compositeLayerTransformAffine,
  compositeLayerTransformPerspective,
  hasLayerTransform,
  fillWithColor,
  fillLayerFrame,
  rotateLayer90,
  scaleLayerTexture,
  resizeCanvasTexture,
  cropLayerTexture,
  setMaskEditLayer,
  clearMaskEditLayer,
  uploadBrushTip,
  uploadBrushTipRGBA,
  clearBrushTip,
  setBrushTipState,
  setBrushDabTransform,
  cacheSubBrushTip,
  cacheSubBrushTipRGBA,
  activateSubBrushTip,
  deactivateSubBrushTip,
  clearSubBrushTipCache,
  getBuiltinBrushTip,
  listBuiltinBrushTips,
  uploadBrushTexture,
  clearBrushTexture,
  setBrushTextureState,
  parsePsd,
  decodeAndUploadPsdLayer,
  getPsdLayerMask,
  setTextLayerContent,
  renderTextLayer,
  renderTextLayerToTexture,
  renderTextLayerTransformed,
  textLayoutBounds,
  textRasterBounds,
  getRenderedTextPixels,
  getGlyphPositions,
  textHitPosition,
  textCursorRect,
  textSelectionRects,
  isFontLoaded,
  expandLayerToDocSize,
  cropLayerToContent,
  floodFillGraduated,
};

/**
 * Bake a layer's effects (and, with `bakeMask`, its mask) into its own
 * texture on the GPU. False when the engine could not bake it.
 */
export function bakeLayerEffects(engine: Engine, layerId: string, bakeMask: boolean): boolean {
  try {
    rawBakeLayerEffects(engine, layerId, bakeMask);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a wgpu export answers with while its readback is still out: the
 * command is parked in the engine under `lopsyTask` until `ready` resolves.
 */
interface PendingReadback {
  lopsyTask: number;
  ready: Promise<void>;
}

function isPendingReadback(value: unknown): value is PendingReadback {
  return typeof value === 'object' && value !== null && 'lopsyTask' in value;
}

/**
 * A readback whose engine was destroyed while it was out: after a lost
 * WebGPU device, or when the canvas unmounts. Its pixels no longer exist.
 */
export class EngineGoneError extends Error {
  constructor() {
    super('The engine was destroyed while a readback was out');
    this.name = 'EngineGoneError';
  }
}

/** wasm-bindgen zeroes an object's pointer when it is freed. */
function isFreed(engine: Engine): boolean {
  return (engine as unknown as { __wbg_ptr?: number }).__wbg_ptr === 0;
}

/**
 * Wait for a parked command's readback, resume it, and repeat until it
 * answers with its value. A command with several readbacks parks once for
 * each.
 */
async function finishReadback<Result>(engine: Engine, pending: PendingReadback): Promise<Result> {
  parkedReadbacks++;
  try {
    let step: unknown = pending;
    while (isPendingReadback(step)) {
      await step.ready;
      if (isFreed(engine)) throw new EngineGoneError();
      step = resumeTask(engine, step.lopsyTask);
    }
    return step as Result;
  } finally {
    parkedReadbacks--;
  }
}

let parkedReadbacks = 0;

/**
 * How many readbacks are out: commands the engine has parked until their
 * pixels arrive. Always 0 on WebGL. A test that records the document's
 * state waits for this to reach 0, since work that follows a readback (a
 * deferred crop, a thumbnail) has not happened yet.
 */
export function parkedReadbackCount(): number {
  return parkedReadbacks;
}

/**
 * Settles when every in-turn readback issued so far has answered and what
 * awaited it has run; null when none is out.
 */
let turn: Promise<unknown> | null = null;

/**
 * The turn passes a task after `until` settles, not in the same one: the
 * caller that awaited the readback acts on it some microtasks later, and
 * the next read must come after that.
 */
function holdTurn(until: Promise<unknown>): void {
  const mine: Promise<void> = until
    .then(noop, noop)
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .then(() => {
      if (turn === mine) turn = null;
    });
  turn = mine;
}

function noop(): void {}

/**
 * Makes a function that reads pixels back from the GPU answer with a
 * Promise. WebGPU cannot read back synchronously: there the engine answers
 * with a parked command, which this waits out. On WebGL the read has
 * already happened and the Promise is resolved (or rejected, if the read
 * threw) on return.
 *
 * `order` matters only while a readback is out, so only on wgpu. A caller
 * usually changes the document with what it read: the crop of a layer left
 * behind, a flip, a fill. On WebGL nothing can come between such a read and
 * the change that follows it. So an `'in-turn'` read issued while another
 * is out waits for that one to answer and for its caller to act on it, and
 * then reads what that left. `'any-time'` is for reads nothing is changed
 * by, which need not wait and are not waited for: thumbnails, the
 * eyedropper.
 */
function asyncReadback<Args extends [Engine, ...unknown[]], Result>(
  read: (...args: Args) => Result,
  order: 'in-turn' | 'any-time' = 'in-turn',
): (...args: Args) => Promise<Result> {
  return (...args: Args): Promise<Result> => {
    const issue = (): { answer: Promise<Result>; isParked: boolean } => {
      try {
        const value: unknown = read(...args);
        if (isPendingReadback(value)) return { answer: finishReadback<Result>(args[0], value), isParked: true };
        return { answer: Promise.resolve(value as Result), isParked: false };
      } catch (err) {
        return { answer: Promise.reject(err), isParked: false };
      }
    };
    if (order === 'any-time') return issue().answer;
    if (turn === null) {
      const issued = issue();
      if (issued.isParked) holdTurn(issued.answer);
      return issued.answer;
    }
    const answer = turn.then(() => issue().answer);
    holdTurn(answer);
    return answer;
  };
}

export const compositeForExport = asyncReadback(rawCompositeForExport);
export const exportPng16 = asyncReadback(rawExportPng16);
export const quantizeCompositeToPalette = asyncReadback(rawQuantizeCompositeToPalette);
export const readLayerPixels = asyncReadback(rawReadLayerPixels);
export const sampleColor = asyncReadback(rawSampleColor, 'any-time');
/** A layer's pixels in document space, as the wand, bucket fill and quick select read them. */
export const readLayerPixelsForFill = asyncReadback(rawReadLayerPixelsForFill);
/** The selection texture's coverage: `[width, height]` as u32 LE, then one byte per pixel. */
export const readSelectionMask = asyncReadback(rawReadSelectionMask);
/** A layer's opaque bounds, texture-local `[x, y, width, height]`; empty when the read failed. */
export const getLayerContentBounds = asyncReadback(rawGetLayerContentBounds);
/** A layer mask's coverage, one byte per pixel, sized like the mask texture. */
export const readMaskTexture = asyncReadback(rawReadMaskTexture);
/** A layer's content-cropped pixels as an LZ4 16-bit blob, for the context-loss backup. */
export const readLayerPixelsLz4U16 = asyncReadback(rawReadLayerPixelsLz4U16);

// Commands that read the GPU inside the engine, work on the bytes and write
// the result back. They answer with a Promise for the same reason a readback
// does, so their callers do not change when the engine's read becomes async.
/** Flood-fill the quick mask from a seed. */
export const fillQuickMask = asyncReadback(rawFillQuickMask);
/** Leave Quick Mask mode; resolves to the selection mask it painted, if any. */
export const exitQuickMaskMode = asyncReadback(rawExitQuickMaskMode);
/** Encode the document as a PSD. */
export const exportPsd = asyncReadback(rawExportPsd);
export const convertLayerToLab = asyncReadback(rawConvertLayerToLab);
export const convertLayerFromLab = asyncReadback(rawConvertLayerFromLab);
export const bakeCmykGamut = asyncReadback(rawBakeCmykGamut);
export const applyPaletteToLayer = asyncReadback(rawApplyPaletteToLayer);
/** Flatten the document into a layer. Reads only in a Lab document, to decode it. */
export const flattenIntoLayer = asyncReadback(rawFlattenIntoLayer);
/** Copy the merged document to the clipboard texture. Reads only in a Lab document. */
export const clipboardCopyMerged = asyncReadback(rawClipboardCopyMerged);
/**
 * Read a layer and build the edge field the magnetic lasso snaps to. Until
 * it resolves there is no field: the caller passes its points through.
 */
export const magneticLassoBegin = asyncReadback(rawMagneticLassoBegin);
export const readLayerThumbnail = asyncReadback(rawReadLayerThumbnail, 'any-time');
export const readCompositeThumbnail = asyncReadback(rawReadCompositeThumbnail, 'any-time');
export const readChannelThumbnail = asyncReadback(rawReadChannelThumbnail, 'any-time');
export const readClipboardPixels = asyncReadback(rawReadClipboardPixels);
/** The quick mask's coverage: `[width, height]` as i32 LE, then one byte per pixel. */
export const readQuickMaskPixels = asyncReadback(rawReadQuickMaskPixels);

/**
 * Every export that writes a layer-mask texture goes through this wrapper
 * so `mask-gpu-dirty` knows the mask changed since the last undo snapshot
 * (#780). The layer id is always the second argument.
 */
function markingMaskDirty<A extends [Engine, string, ...unknown[]], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    markMaskGpuDirty(args[1]);
    return fn(...args);
  };
}

export const uploadLayerMask = markingMaskDirty(rawUploadLayerMask);
export const removeLayerMask = markingMaskDirty(rawRemoveLayerMask);
export const paintMaskDab = markingMaskDirty(rawPaintMaskDab);
export const paintMaskDabBatch = markingMaskDirty(rawPaintMaskDabBatch);
export const drawMaskPencilLine = markingMaskDirty(rawDrawMaskPencilLine);
export const fillMask = asyncReadback(markingMaskDirty(rawFillMask));
export const remapLayerMask = markingMaskDirty(rawRemapLayerMask);
export const fillMaskWithValue = markingMaskDirty(rawFillMaskWithValue);
export const renderMaskLinearGradient = markingMaskDirty(rawRenderMaskLinearGradient);
export const renderMaskRadialGradient = markingMaskDirty(rawRenderMaskRadialGradient);
export const restoreMaskFromGpuSnapshot = markingMaskDirty(rawRestoreMaskFromGpuSnapshot);
export const endMaskFilterTarget = markingMaskDirty(rawEndMaskFilterTarget);

/**
 * Every export that can change how unchanged text props lay out goes through
 * this wrapper, so props-keyed text measurement caches drop their entries.
 */
function bumpingTextLayout<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    bumpTextLayoutGeneration();
    return fn(...args);
  };
}

export const loadFontData = bumpingTextLayout(rawLoadFontData);
export const loadFontDataForFamily = bumpingTextLayout(rawLoadFontDataForFamily);
export const removeTextLayerState = bumpingTextLayout(rawRemoveTextLayerState);
