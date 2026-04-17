import type { Meta, StoryObj } from '@storybook/react-vite';
import { LevelsEditor } from './LevelsEditor';
import { IDENTITY_LEVELS } from '../../filters/levels';

const meta: Meta<typeof LevelsEditor> = {
  component: LevelsEditor,
};

export default meta;

type Story = StoryObj<typeof LevelsEditor>;

export const Default: Story = {
  args: {
    levels: IDENTITY_LEVELS,
    onChange: (levels) => console.log('LevelsEditor onChange', levels),
    onReset: () => console.log('LevelsEditor onReset'),
  },
};

export const Modified: Story = {
  args: {
    levels: {
      ...IDENTITY_LEVELS,
      rgb: { inputBlack: 10, inputWhite: 245, gamma: 1.2, outputBlack: 0, outputWhite: 255 },
      r: { inputBlack: 5, inputWhite: 250, gamma: 0.9, outputBlack: 0, outputWhite: 255 },
      g: IDENTITY_LEVELS.g,
      b: IDENTITY_LEVELS.b,
    },
    onChange: (levels) => console.log('LevelsEditor onChange', levels),
    onReset: () => console.log('LevelsEditor onReset'),
  },
};
