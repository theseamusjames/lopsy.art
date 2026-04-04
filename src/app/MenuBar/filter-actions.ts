import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterInvert,
  filterDesaturate,
  filterAddNoise,
  filterFillWithNoise,
  filterFindEdges,
} from '../../engine-wasm/wasm-bridge';
import { filterRegistry } from './filters';
import type { FilterDefinition } from './filters';

export type FilterDialogId =
  | 'gaussian-blur'
  | 'box-blur'
  | 'unsharp-mask'
  | 'add-noise'
  | 'fill-noise'
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'posterize'
  | 'threshold'
  | 'motion-blur'
  | 'radial-blur'
  | 'find-edges'
  | 'cel-shading'
  | 'clouds'
  | 'smoke';

function getActiveLayerId(): string | null {
  return useEditorStore.getState().document.activeLayerId;
}

function clearJsPixelData(layerId: string): void {
  const state = useEditorStore.getState();
  const pixelDataMap = new Map(state.layerPixelData);
  pixelDataMap.delete(layerId);
  const sparseMap = new Map(state.sparseLayerData);
  sparseMap.delete(layerId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(layerId);
  useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
}

export function getFilterDialogConfig(id: FilterDialogId): FilterDefinition | null {
  return filterRegistry[id] ?? null;
}

export function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;

  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filter.applyGpu(engine, activeId, values);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyInvert(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterInvert(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyDesaturate(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterDesaturate(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyAddNoise(amount: number, monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterAddNoise(engine, activeId, amount, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFillWithNoise(monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterFillWithNoise(engine, activeId, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFindEdges(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterFindEdges(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}
