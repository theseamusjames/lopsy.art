import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasSizeModal } from './CanvasSizeModal';

const meta: Meta<typeof CanvasSizeModal> = {
  component: CanvasSizeModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof CanvasSizeModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
