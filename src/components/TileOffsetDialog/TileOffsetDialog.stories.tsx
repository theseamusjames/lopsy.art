import type { Meta, StoryObj } from '@storybook/react';
import { TileOffsetDialog } from './TileOffsetDialog';

const meta: Meta<typeof TileOffsetDialog> = {
  title: 'Dialogs/TileOffsetDialog',
  component: TileOffsetDialog,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof TileOffsetDialog>;

export const Default: Story = {
  args: {
    onApply: (settings) => console.log('Apply', settings),
    onCancel: () => console.log('Cancel'),
  },
};
