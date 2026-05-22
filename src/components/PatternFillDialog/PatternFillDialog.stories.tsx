import type { Meta, StoryObj } from '@storybook/react-vite';
import { PatternFillDialog } from './PatternFillDialog';

const meta: Meta<typeof PatternFillDialog> = {
  component: PatternFillDialog,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof PatternFillDialog>;

export const Default: Story = {
  args: {
    onApply: (opts) => console.log('apply', opts),
    onCancel: () => console.log('cancel'),
  },
};
