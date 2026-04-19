import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilterDialog } from './FilterDialog';

const meta: Meta<typeof FilterDialog> = {
  component: FilterDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    onApply: (v) => console.log('apply', v),
    onCancel: () => console.log('cancel'),
  },
};

export default meta;
type Story = StoryObj<typeof FilterDialog>;

export const GaussianBlur: Story = {
  args: {
    title: 'Gaussian Blur',
    params: [
      { key: 'radius', label: 'Radius', min: 0, max: 100, step: 0.5, defaultValue: 8 },
    ],
  },
};

export const Sharpen: Story = {
  args: {
    title: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 500, step: 1, defaultValue: 50 },
      { key: 'radius', label: 'Radius', min: 0.1, max: 10, step: 0.1, defaultValue: 1 },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 0 },
    ],
  },
};
