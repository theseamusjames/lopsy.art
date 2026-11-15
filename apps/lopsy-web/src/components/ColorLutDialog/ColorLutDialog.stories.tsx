import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorLutDialog } from './ColorLutDialog';

const meta: Meta<typeof ColorLutDialog> = {
  component: ColorLutDialog,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ColorLutDialog>;

export const Default: Story = {
  args: {
    onApply: () => console.log('apply'),
    onCancel: () => console.log('cancel'),
    onPreviewChange: () => {},
    onPreviewStart: () => {},
    onPreviewStop: () => {},
  },
};
