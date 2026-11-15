import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Toasts } from './Toasts';
import { notifyError, notifyInfo, useNotificationsStore } from '../../app/notifications-store';

const meta: Meta<typeof Toasts> = {
  component: Toasts,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof Toasts>;

function Seeded({ seed }: { seed: () => void }) {
  const { notifications } = useNotificationsStore();
  useEffect(() => {
    if (notifications.length === 0) seed();
  }, [notifications.length, seed]);
  return <Toasts />;
}

export const Error: Story = {
  render: () => <Seeded seed={() => notifyError('Failed to import PSD: unsupported layer mode')} />,
};

export const Info: Story = {
  render: () => <Seeded seed={() => notifyInfo('Document saved locally.')} />,
};

export const Stacked: Story = {
  render: () => (
    <Seeded
      seed={() => {
        notifyError('Failed to open image: corrupt JPEG data');
        notifyInfo('Filter applied: Gaussian Blur');
        notifyError('WebGL context lost — rendering paused.');
      }}
    />
  ),
};
