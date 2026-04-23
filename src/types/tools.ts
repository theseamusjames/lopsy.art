import type { Color } from './color';

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
  | 'smudge'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-magnetic'
  | 'wand'
  | 'shape'
  | 'text'
  | 'crop'
  | 'path'
  | 'spray'
  | 'liquify';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

export interface PointerInput {
  readonly x: number; // canvas coordinates
  readonly y: number;
  readonly pressure: number; // 0-1
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly button: number; // 0=left, 1=middle, 2=right
}
