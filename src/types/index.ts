// ============================================================
// Core Types for the Loppsy Image Editor
// ============================================================

// --- Geometry ---

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// --- Color ---

export interface Color {
  readonly r: number; // 0-255
  readonly g: number; // 0-255
  readonly b: number; // 0-255
  readonly a: number; // 0-1
}

export interface HSLColor {
  readonly h: number; // 0-360
  readonly s: number; // 0-100
  readonly l: number; // 0-100
  readonly a: number; // 0-1
}

// --- Blend Modes ---

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

// --- Layers ---

export type LayerType = 'raster' | 'text' | 'shape' | 'group' | 'adjustment' | 'fill';

export interface LayerBase {
  readonly id: string;
  readonly name: string;
  readonly type: LayerType;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number; // 0-1
  readonly blendMode: BlendMode;
  readonly x: number;
  readonly y: number;
  readonly clipToBelow: boolean;
  readonly maskId: string | null;
}

export interface RasterLayer extends LayerBase {
  readonly type: 'raster';
  readonly width: number;
  readonly height: number;
}

export interface TextLayer extends LayerBase {
  readonly type: 'text';
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic';
  readonly color: Color;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textAlign: 'left' | 'center' | 'right' | 'justify';
  readonly width: number | null; // null = point text, number = area text
}

export interface ShapeLayer extends LayerBase {
  readonly type: 'shape';
  readonly shapeType: ShapeType;
  readonly fill: Color | null;
  readonly stroke: Color | null;
  readonly strokeWidth: number;
  readonly points: readonly Point[];
  readonly width: number;
  readonly height: number;
  readonly cornerRadius: number;
}

export interface GroupLayer extends LayerBase {
  readonly type: 'group';
  readonly children: readonly string[]; // layer IDs
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | GroupLayer;

// --- Selection ---

export interface SelectionState {
  readonly active: boolean;
  readonly maskData: ImageData | null; // grayscale mask
  readonly bounds: Rect | null;
}

// --- Tools ---

export type ToolId =
  | 'move'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'gradient'
  | 'eyedropper'
  | 'stamp'
  | 'dodge'
  | 'burn'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-poly'
  | 'wand'
  | 'shape'
  | 'text'
  | 'crop'
  | 'path';

export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'star';

// --- Pointer Input ---

export interface PointerInput {
  readonly x: number; // canvas coordinates
  readonly y: number;
  readonly pressure: number; // 0-1
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly button: number; // 0=left, 1=middle, 2=right
}

// --- Document ---

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

// --- Viewport ---

export interface ViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly width: number;
  readonly height: number;
}

// --- History ---

export interface HistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
}
