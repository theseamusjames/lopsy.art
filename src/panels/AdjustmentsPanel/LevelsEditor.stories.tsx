import type { Meta, StoryObj } from '@storybook/react-vite';
import { LevelsEditor } from './LevelsEditor';
import { IDENTITY_LEVELS } from '../../filters/levels';
import type { Histogram } from './histogram-compute';

const meta: Meta<typeof LevelsEditor> = {
  component: LevelsEditor,
};

export default meta;

type Story = StoryObj<typeof LevelsEditor>;

function bellHistogram(centre: number, spread: number, peak: number): Uint32Array {
  const bins = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const d = (i - centre) / spread;
    bins[i] = Math.round(peak * Math.exp(-d * d));
  }
  return bins;
}

const sampleHistogram: Histogram = {
  r: bellHistogram(170, 35, 1200),
  g: bellHistogram(135, 50, 900),
  b: bellHistogram(95, 45, 1100),
  total: 50_000,
};

export const Default: Story = {
  args: {
    levels: IDENTITY_LEVELS,
    histogram: sampleHistogram,
    onChange: (levels) => console.log('LevelsEditor onChange', levels),
    onReset: () => console.log('LevelsEditor onReset'),
  },
};

export const Modified: Story = {
  args: {
    levels: {
      ...IDENTITY_LEVELS,
      rgb: { inputBlack: 0.05, inputWhite: 0.92, gamma: 1.2, outputBlack: 0, outputWhite: 1 },
      r: { inputBlack: 0.02, inputWhite: 0.98, gamma: 0.9, outputBlack: 0, outputWhite: 1 },
      g: IDENTITY_LEVELS.g,
      b: IDENTITY_LEVELS.b,
    },
    histogram: sampleHistogram,
    onChange: (levels) => console.log('LevelsEditor onChange', levels),
    onReset: () => console.log('LevelsEditor onReset'),
  },
};

export const EmptyHistogram: Story = {
  args: {
    levels: IDENTITY_LEVELS,
    histogram: { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), total: 0 },
    onChange: (levels) => console.log('LevelsEditor onChange', levels),
    onReset: () => console.log('LevelsEditor onReset'),
  },
};
