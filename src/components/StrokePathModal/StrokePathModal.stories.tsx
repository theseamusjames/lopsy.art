import type { Meta, StoryObj } from '@storybook/react-vite';
import { StrokePathModal } from './StrokePathModal';

const meta: Meta<typeof StrokePathModal> = {
  component: StrokePathModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof StrokePathModal>;

export const Default: Story = {};
