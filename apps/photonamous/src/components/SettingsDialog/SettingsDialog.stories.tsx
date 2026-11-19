import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { SettingsDialog } from './SettingsDialog';

const meta: Meta<typeof SettingsDialog> = {
  component: SettingsDialog,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof SettingsDialog>;

export const Default: Story = {};
