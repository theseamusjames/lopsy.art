import type { Meta, StoryObj } from '@storybook/react-vite';
import { GradientModal } from './GradientModal';

const meta: Meta<typeof GradientModal> = {
  component: GradientModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof GradientModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
