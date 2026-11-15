import type { Meta, StoryObj } from '@storybook/react-vite';
import { BlendModeSelect } from './BlendModeSelect';

const meta: Meta<typeof BlendModeSelect> = {
  component: BlendModeSelect,
  args: { onChange: () => {} },
};

export default meta;
type Story = StoryObj<typeof BlendModeSelect>;

export const Layer: Story = {
  args: { value: 'multiply', isGroup: false, allowHsl: true },
};

export const Group: Story = {
  args: { value: 'pass-through', isGroup: true, allowHsl: true },
};

export const WithoutHslModes: Story = {
  args: { value: 'normal', isGroup: false, allowHsl: false },
};
