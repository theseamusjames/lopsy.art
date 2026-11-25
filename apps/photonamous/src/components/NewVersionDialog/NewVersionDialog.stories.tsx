import type { Meta, StoryObj } from '@storybook/react-vite';
import { NewVersionDialog } from './NewVersionDialog';

const meta: Meta<typeof NewVersionDialog> = {
  component: NewVersionDialog,
};

export default meta;
type Story = StoryObj<typeof NewVersionDialog>;

export const Default: Story = { args: { suggested: 'Version 2', onCreate: () => undefined, onClose: () => undefined } };
