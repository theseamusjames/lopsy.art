import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeDriveLibrary, withFakeLibrary } from '../../stories/fake-library';
import { CloudProviderSettings } from './CloudProviderSettings';

const meta: Meta<typeof CloudProviderSettings> = {
  component: CloudProviderSettings,
};

export default meta;
type Story = StoryObj<typeof CloudProviderSettings>;

export const GoogleDrive: Story = { decorators: [withFakeDriveLibrary] };

/** A library on this computer (development builds only) has no cloud provider. */
export const InThisBrowser: Story = { decorators: [withFakeLibrary] };
