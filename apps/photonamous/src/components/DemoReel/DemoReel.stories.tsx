import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoReel } from './DemoReel';

const meta: Meta<typeof DemoReel> = {
  component: DemoReel,
  decorators: [
    (Story) => (
      <div style={{ width: 960, height: 800 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DemoReel>;

/** In the 6:5 box the start screen gives it on a 16:9 window. */
export const Default: Story = {};
