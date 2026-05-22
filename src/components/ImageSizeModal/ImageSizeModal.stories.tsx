import type { Meta, StoryObj } from '@storybook/react-vite';
import { ImageSizeModal } from './ImageSizeModal';

const meta: Meta<typeof ImageSizeModal> = {
  component: ImageSizeModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ImageSizeModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
