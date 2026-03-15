import type { Color } from './color';
import type { Layer } from './layers';
import type { Rect } from './geometry';

export interface DocumentState {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly layers: readonly Layer[];
  readonly layerOrder: readonly string[]; // bottom to top
  readonly activeLayerId: string | null;
  readonly backgroundColor: Color;
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
