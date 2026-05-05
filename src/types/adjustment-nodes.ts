import type { Curves } from '../filters/curves';
import type { Levels } from '../filters/levels';

export interface BaseAdjustmentNode {
  readonly id: string;
  readonly enabled: boolean;
}

export interface ExposureNode extends BaseAdjustmentNode {
  readonly type: 'exposure';
  readonly exposure: number;
}

export interface ContrastNode extends BaseAdjustmentNode {
  readonly type: 'contrast';
  readonly contrast: number;
}

export interface HighlightsShadowsNode extends BaseAdjustmentNode {
  readonly type: 'highlights-shadows';
  readonly highlights: number;
  readonly shadows: number;
  readonly whites: number;
  readonly blacks: number;
}

export interface SaturationNode extends BaseAdjustmentNode {
  readonly type: 'saturation';
  readonly saturation: number;
  readonly vibrance: number;
}

export interface VignetteNode extends BaseAdjustmentNode {
  readonly type: 'vignette';
  readonly vignette: number;
}

export interface CurvesNode extends BaseAdjustmentNode {
  readonly type: 'curves';
  readonly curves: Curves;
}

export interface LevelsNode extends BaseAdjustmentNode {
  readonly type: 'levels';
  readonly levels: Levels;
}

export interface ColorBalanceNode extends BaseAdjustmentNode {
  readonly type: 'color-balance';
  readonly shadowsCMY: [number, number, number];
  readonly midtonesCMY: [number, number, number];
  readonly highlightsCMY: [number, number, number];
}

export interface GradientMapNode extends BaseAdjustmentNode {
  readonly type: 'gradient-map';
  readonly stops: ReadonlyArray<{ readonly position: number; readonly color: { readonly r: number; readonly g: number; readonly b: number } }>;
}

export interface BlackWhiteNode extends BaseAdjustmentNode {
  readonly type: 'black-white';
  readonly reds: number;
  readonly yellows: number;
  readonly greens: number;
  readonly cyans: number;
  readonly blues: number;
  readonly magentas: number;
}

export interface PhotoFilterNode extends BaseAdjustmentNode {
  readonly type: 'photo-filter';
  readonly color: { readonly r: number; readonly g: number; readonly b: number };
  readonly density: number;
  readonly preserveLuminosity: boolean;
}

export interface ChannelMixerNode extends BaseAdjustmentNode {
  readonly type: 'channel-mixer';
  readonly outputChannel: 'red' | 'green' | 'blue';
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly constant: number;
}

export interface InvertNode extends BaseAdjustmentNode {
  readonly type: 'invert';
}

export interface HueSaturationNode extends BaseAdjustmentNode {
  readonly type: 'hue-saturation';
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

export type AdjustmentNode =
  | ExposureNode
  | ContrastNode
  | HighlightsShadowsNode
  | SaturationNode
  | VignetteNode
  | CurvesNode
  | LevelsNode
  | ColorBalanceNode
  | GradientMapNode
  | BlackWhiteNode
  | PhotoFilterNode
  | ChannelMixerNode
  | InvertNode
  | HueSaturationNode;

export type AdjustmentNodeType = AdjustmentNode['type'];
