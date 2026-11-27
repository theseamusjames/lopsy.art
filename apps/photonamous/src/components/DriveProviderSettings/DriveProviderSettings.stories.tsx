import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeDriveLibrary } from '../../stories/fake-library';
import { DriveProviderSettings } from './DriveProviderSettings';

const meta: Meta<typeof DriveProviderSettings> = {
  component: DriveProviderSettings,
  decorators: [withFakeDriveLibrary],
};

export default meta;
type Story = StoryObj<typeof DriveProviderSettings>;

/** The development backend can't show Google's Picker in the page, so only the move-or-leave choice shows. */
export const Default: Story = {};
