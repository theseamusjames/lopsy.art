import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChannelsPanel } from './ChannelsPanel';

const meta: Meta<typeof ChannelsPanel> = {
  component: ChannelsPanel,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--color-bg-primary)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChannelsPanel>;

export const Default: Story = {};
