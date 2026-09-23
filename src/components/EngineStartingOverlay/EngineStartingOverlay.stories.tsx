import type { Meta, StoryObj } from '@storybook/react-vite';
import { EngineStartingOverlay } from './EngineStartingOverlay';

const meta: Meta<typeof EngineStartingOverlay> = {
  component: EngineStartingOverlay,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof EngineStartingOverlay>;

export const Default: Story = {};
