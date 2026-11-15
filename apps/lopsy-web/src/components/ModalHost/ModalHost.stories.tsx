import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModalHost, LoadingOverlay } from './ModalHost';

const meta: Meta<typeof ModalHost> = {
  component: ModalHost,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ModalHost>;

export const NoModal: Story = {};

export const Loading: Story = {
  render: () => <LoadingOverlay message="Importing PSD file..." />,
};
