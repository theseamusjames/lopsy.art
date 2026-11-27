import type { Meta, StoryObj } from '@storybook/react-vite';
import { GeneralSettings } from './GeneralSettings';

const meta: Meta<typeof GeneralSettings> = {
  component: GeneralSettings,
};

export default meta;
type Story = StoryObj<typeof GeneralSettings>;

export const Default: Story = { args: { deviceName: 'Studio laptop' } };

export const Reading: Story = { args: { deviceName: null } };
