import type { Meta, StoryObj } from '@storybook/react-vite';
import { BrushModal } from './BrushModal';

const meta: Meta<typeof BrushModal> = {
  component: BrushModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof BrushModal>;

export const Default: Story = {};
