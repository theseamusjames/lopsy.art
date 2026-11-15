import type { Meta, StoryObj } from '@storybook/react-vite';
import { SymmetryControls } from './SymmetryControls';

const meta: Meta<typeof SymmetryControls> = {
  component: SymmetryControls,
};

export default meta;
type Story = StoryObj<typeof SymmetryControls>;

export const Default: Story = {};

export const WithRadial: Story = {
  args: { showRadial: true },
};
