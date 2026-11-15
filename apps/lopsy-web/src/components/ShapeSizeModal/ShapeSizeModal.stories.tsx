import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShapeSizeModal } from './ShapeSizeModal';

const meta: Meta<typeof ShapeSizeModal> = {
  component: ShapeSizeModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ShapeSizeModal>;

export const Default: Story = {
  args: {
    onConfirm: (w, h) => console.log('confirm', w, h),
    onCancel: () => console.log('cancel'),
  },
};
