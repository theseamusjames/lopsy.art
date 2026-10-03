import type { Color, BlendMode } from './color';
import type { Point } from './geometry';
import type { LayerEffects, LayerMask } from './effects';
import type { AdjustmentNode } from './adjustment-nodes';

export type LayerType = 'raster' | 'text' | 'shape' | 'group';

export type LayerColorTag = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export type FontStyle = 'normal' | 'italic';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

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
  readonly effects: LayerEffects;
  readonly mask: LayerMask | null;
  readonly colorTag?: LayerColorTag | null;
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
  readonly fontStyle: FontStyle;
  /** Base colour of the text; ranges in `colorSpans` override it. */
  readonly color: Color;
  /**
   * Per-range colours, sorted and non-overlapping, each differing from
   * `color`. Absent or empty means the whole text is `color`.
   */
  readonly colorSpans?: readonly TextColorSpan[];
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly paragraphSpacing: number;
  readonly textAlign: TextAlign;
  readonly width: number | null; // null = point text, number = area text
  readonly underline: boolean;
  readonly strikethrough: boolean;
  /**
   * When true, glyphs stack top-to-bottom in a column centered on the text
   * anchor and each `\n` starts a new column. `letterSpacing` becomes the extra
   * vertical distance between glyphs; `lineHeight` scales the column advance.
   */
  readonly vertical?: boolean;
  readonly pathId?: string;
  readonly prePathX?: number;
  readonly prePathY?: number;
  /**
   * Where the path layout last placed a path-bound layer (document space).
   * `x - pathAnchorX` is the user's offset from the path (a move or nudge),
   * which a reflow — new size, spacing, text, path edit, or a history
   * restore — preserves instead of snapping back onto the path (#981).
   */
  readonly pathAnchorX?: number;
  readonly pathAnchorY?: number;
  /**
   * Rotation / scale / skew / flip of the text, kept as data so every
   * re-render (edit, Text-panel change, font load) re-applies it to freshly
   * laid-out glyphs instead of losing or compounding it. Absent means upright.
   */
  readonly transform?: TextTransform;
}

/** A colour over the text range `[start, end)` (UTF-16 string indices). */
export interface TextColorSpan {
  readonly start: number;
  readonly end: number;
  readonly color: Color;
}

/**
 * Placement of a transformed text layer: layout point `p` lands at document
 * `[a c; b d] · p + anchor`. The anchor is stored relative to the layer's
 * `x`/`y` (its texture top-left) so moving the layer carries the text.
 */
export interface TextTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly anchorX: number;
  readonly anchorY: number;
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
  readonly collapsed: boolean;
  readonly adjustments: readonly AdjustmentNode[];
  readonly adjustmentsEnabled: boolean;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | GroupLayer;

export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'star';
