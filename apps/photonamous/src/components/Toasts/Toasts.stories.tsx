import type { Meta, StoryObj } from '@storybook/react-vite';
import { showErrorToast, showToast, useToasts } from '../../app/toasts';
import { Toasts } from './Toasts';

const meta: Meta<typeof Toasts> = {
  component: Toasts,
};

export default meta;
type Story = StoryObj<typeof Toasts>;

export const Messages: Story = {
  render: () => {
    useToasts.setState({ toasts: [] });
    showToast('Imported 12 photos', null);
    showToast('Photo dropped.', null, { label: 'Undo', run: () => undefined });
    return <Toasts />;
  },
};

export const WithError: Story = {
  render: () => {
    useToasts.setState({ toasts: [] });
    showErrorToast('Adding from Google Drive failed: the connection was lost.', null);
    showToast('Imported 12 photos', null);
    return <Toasts />;
  },
};
