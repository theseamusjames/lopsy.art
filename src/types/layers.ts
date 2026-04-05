import type { Color, BlendMode } from './color';
import type { Point } from './geometry';
import type { LayerEffects, LayerMask } from './effects';

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
  readonly effects: LayerEffects;
  readonly mask: LayerMask | null;
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
  readonly collapsed: boolean;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | GroupLayer;

export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'star';
