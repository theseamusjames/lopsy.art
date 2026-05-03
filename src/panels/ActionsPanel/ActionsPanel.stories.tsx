import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionsPanel } from './ActionsPanel';

const meta: Meta<typeof ActionsPanel> = {
  component: ActionsPanel,
};

export default meta;

type Story = StoryObj<typeof ActionsPanel>;

export const Default: Story = {};
