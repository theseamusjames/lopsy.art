import type { ComponentType } from 'react';
import type { AdjustmentNodeType } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import { ExposureControls } from './ExposureControls';
import { ContrastControls } from './ContrastControls';
import { HighlightsShadowsControls } from './HighlightsShadowsControls';
import { SaturationControls } from './SaturationControls';
import { VignetteControls } from './VignetteControls';
import { CurvesControls } from './CurvesControls';
import { LevelsControls } from './LevelsControls';
import { HueSaturationControls } from './HueSaturationControls';
import { ColorBalanceControls } from './ColorBalanceControls';
import { PhotoFilterControls } from './PhotoFilterControls';
import { BlackWhiteControls } from './BlackWhiteControls';
import { ChannelMixerControls } from './ChannelMixerControls';
import { GradientMapControls } from './GradientMapControls';

export const NODE_CONTROLS_MAP: Partial<Record<AdjustmentNodeType, ComponentType<NodeControlProps>>> = {
  exposure: ExposureControls as ComponentType<NodeControlProps>,
  contrast: ContrastControls as ComponentType<NodeControlProps>,
  'highlights-shadows': HighlightsShadowsControls as ComponentType<NodeControlProps>,
  saturation: SaturationControls as ComponentType<NodeControlProps>,
  vignette: VignetteControls as ComponentType<NodeControlProps>,
  curves: CurvesControls as ComponentType<NodeControlProps>,
  levels: LevelsControls as ComponentType<NodeControlProps>,
  'hue-saturation': HueSaturationControls as ComponentType<NodeControlProps>,
  'color-balance': ColorBalanceControls as ComponentType<NodeControlProps>,
  'photo-filter': PhotoFilterControls as ComponentType<NodeControlProps>,
  'black-white': BlackWhiteControls as ComponentType<NodeControlProps>,
  'channel-mixer': ChannelMixerControls as ComponentType<NodeControlProps>,
  'gradient-map': GradientMapControls as ComponentType<NodeControlProps>,
};
