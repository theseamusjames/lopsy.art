import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeDriveLibrary, withFakeLibrary } from '../../stories/fake-library';
import { SettingsDialog } from './SettingsDialog';

const meta: Meta<typeof SettingsDialog> = {
  component: SettingsDialog,
};

export default meta;
type Story = StoryObj<typeof SettingsDialog>;

export const Default: Story = { decorators: [withFakeLibrary] };

export const Data: Story = { args: { initialSection: 'data' }, decorators: [withFakeLibrary] };

/** A Google Drive library: its provider's settings show. */
export const CloudProvider: Story = { args: { initialSection: 'cloud' }, decorators: [withFakeDriveLibrary] };
