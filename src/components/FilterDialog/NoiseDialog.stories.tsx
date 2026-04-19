import type { Meta, StoryObj } from '@storybook/react-vite';
import { NoiseDialog } from './NoiseDialog';

const meta: Meta<typeof NoiseDialog> = {
  component: NoiseDialog,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof NoiseDialog>;

export const Default: Story = {
  args: {
    title: 'Add Noise',
    onApply: (s) => console.log('apply', s),
    onCancel: () => console.log('cancel'),
  },
};
