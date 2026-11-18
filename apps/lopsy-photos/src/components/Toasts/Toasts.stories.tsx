import type { Meta, StoryObj } from '@storybook/react-vite';
import { showToast, useToasts } from '../../app/toasts';
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
    showToast('Photo set aside.', null, { label: 'Undo', run: () => undefined });
    return <Toasts />;
  },
};
