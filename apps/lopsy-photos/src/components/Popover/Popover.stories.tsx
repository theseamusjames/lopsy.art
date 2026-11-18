import type { Meta, StoryObj } from '@storybook/react-vite';
import { Popover } from './Popover';

const meta: Meta<typeof Popover> = {
  component: Popover,
  args: { label: 'Presets', onClose: () => undefined },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  args: { children: <p style={{ padding: 8 }}>What the popover holds.</p> },
  decorators: [(Story) => <div style={{ position: 'relative', height: 160, display: 'flex', justifyContent: 'flex-end' }}><Story /></div>],
};
export const AlignStart: Story = {
  args: { align: 'start', children: <p style={{ padding: 8 }}>Opens from the left.</p> },
  decorators: [(Story) => <div style={{ position: 'relative', height: 160 }}><Story /></div>],
};
