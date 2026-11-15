import type { Meta, StoryObj } from '@storybook/react-vite';
import { AboutModal } from './AboutModal';

const meta: Meta<typeof AboutModal> = {
  component: AboutModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof AboutModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
