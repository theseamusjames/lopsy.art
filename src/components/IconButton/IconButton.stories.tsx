import type { Meta, StoryObj } from '@storybook/react-vite';
import { Brush, Eraser, Move, Square } from 'lucide-react';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  component: IconButton,
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: { icon: <Brush size={18} />, label: 'Brush' },
};

export const Active: Story = {
  args: { icon: <Eraser size={18} />, label: 'Eraser', isActive: true },
};

export const Medium: Story = {
  args: { icon: <Move size={22} />, label: 'Move', size: 'md' },
};

export const Disabled: Story = {
  args: { icon: <Square size={18} />, label: 'Shape', disabled: true },
};
