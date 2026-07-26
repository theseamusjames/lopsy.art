import type { Color } from './color';
import type { DocumentColorMode } from './color-mode';
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
  /** Full set of selected layer IDs. Always includes activeLayerId when non-null. */
  readonly selectedLayerIds: readonly string[];
  readonly backgroundColor: Color;
  readonly colorMode: DocumentColorMode;
  /** Palette for `indexed` mode (≤256 entries). Absent in other modes. */
  readonly indexedPalette?: readonly Color[];
  readonly rootGroupId?: string | null;
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
