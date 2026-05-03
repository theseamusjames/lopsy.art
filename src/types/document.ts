import type { Color } from './color';
import type { Layer } from './layers';
import type { Rect } from './geometry';

export interface Artboard {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DocumentState {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly layers: readonly Layer[];
  readonly layerOrder: readonly string[]; // bottom to top
  readonly activeLayerId: string | null;
  /** Full set of selected layer IDs. Always includes activeLayerId when non-null. */
  readonly selectedLayerIds: readonly string[];
  readonly backgroundColor: Color;
  readonly rootGroupId?: string | null;
  readonly artboards: readonly Artboard[];
}

export interface ViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionState {
  readonly active: boolean;
  readonly maskData: ImageData | null; // grayscale mask
  readonly bounds: Rect | null;
}

export interface HistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
}
