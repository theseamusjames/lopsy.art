import type { Meta, StoryObj } from '@storybook/react-vite';
import { GuideColorPicker } from './GuideColorPicker';

const meta: Meta<typeof GuideColorPicker> = {
  component: GuideColorPicker,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof GuideColorPicker>;

export const Default: Story = {};
