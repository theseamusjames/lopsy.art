import type { Meta, StoryObj } from '@storybook/react-vite';
import { BorderModal } from './BorderModal';

const meta: Meta<typeof BorderModal> = {
  component: BorderModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof BorderModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
