import type { Meta, StoryObj } from '@storybook/react-vite';
import { PreciseAdjustmentHandle } from './PreciseAdjustmentHandle';

const meta: Meta<typeof PreciseAdjustmentHandle> = {
  component: PreciseAdjustmentHandle,
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: 20, width: 300, marginTop: 8 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PreciseAdjustmentHandle>;

export const Default: Story = {
  args: {
    position: 0.5,
    swatch: '#7f7f7f',
    ariaLabel: 'Midpoint',
  },
};

export const Active: Story = {
  args: {
    position: 0.5,
    swatch: '#7f7f7f',
    active: true,
    ariaLabel: 'Midpoint',
  },
};

export const BlackAndWhite: Story = {
  render: () => (
    <div style={{ position: 'relative', height: 20, width: 300, marginTop: 8 }}>
      <PreciseAdjustmentHandle position={0} swatch="#0d0d0d" ariaLabel="Black" />
      <PreciseAdjustmentHandle position={1} swatch="#ffffff" ariaLabel="White" />
    </div>
  ),
};
