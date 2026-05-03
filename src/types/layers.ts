import type { Color, BlendMode } from './color';
import type { Point } from './geometry';
import type { LayerEffects, LayerMask } from './effects';
import type { ImageAdjustments } from '../filters/image-adjustments';
import type { GradientStop } from '../tools/gradient/gradient';

export type LayerType = 'raster' | 'text' | 'shape' | 'group' | 'fill';

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
  readonly color: Color;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textAlign: TextAlign;
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
  readonly adjustments: ImageAdjustments;
  readonly adjustmentsEnabled: boolean;
}

export interface SolidColorFill {
  readonly type: 'solid-color';
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
}

export interface GradientFill {
  readonly type: 'gradient';
  readonly stops: readonly GradientStop[];
  readonly gradientType: 'linear' | 'radial';
  readonly angle: number;
  readonly reverse: boolean;
}

export interface PatternFill {
  readonly type: 'pattern';
  readonly patternId: string;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export type FillConfig = SolidColorFill | GradientFill | PatternFill;

export interface FillLayer extends LayerBase {
  readonly type: 'fill';
  readonly fill: FillConfig;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | GroupLayer | FillLayer;

export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'star';
