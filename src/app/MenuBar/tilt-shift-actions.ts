import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { saveFilterPreview, restoreFilterPreview, clearFilterPreview, filterTiltShiftBlur } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { syncAndClearLayerAfterFilter } from './filter-layer-sync';

export function beginTiltShiftSession(): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  saveFilterPreview(engine, activeId);

  useUIStore.getState().setTiltShift({
    focusPosition: 0.5,
    focusWidth: 0.4,
    blurRadius: 12,
    angle: 0,
    dragging: null,
    dragAnchor: 0,
    previewActive: true,
  });

  filterTiltShiftBlur(engine, activeId, 0.5, 0.4, 12, 0);
  syncAndClearLayerAfterFilter(engine, activeId);
  useEditorStore.getState().notifyRender();
}

export function previewTiltShift(): void {
  const session = useUIStore.getState().tiltShift;
  if (!session || !session.previewActive) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  const angleRad = (session.angle * Math.PI) / 180;
  filterTiltShiftBlur(engine, activeId, session.focusPosition, session.focusWidth, session.blurRadius, angleRad);
  syncAndClearLayerAfterFilter(engine, activeId);
  useEditorStore.getState().notifyRender();
}

export function cancelTiltShift(): void {
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (activeId) {
    clearJsPixelData(activeId);
  }

  useUIStore.getState().setTiltShift(null);
  useEditorStore.getState().notifyRender();
}

export function applyTiltShift(): void {
  const session = useUIStore.getState().tiltShift;
  if (!session) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Tilt-Shift Blur');
  const angleRad = (session.angle * Math.PI) / 180;
  filterTiltShiftBlur(engine, activeId, session.focusPosition, session.focusWidth, session.blurRadius, angleRad);
  syncAndClearLayerAfterFilter(engine, activeId);

  useUIStore.getState().setTiltShift(null);
  useEditorStore.getState().notifyRender();
}
