import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { DataSettings } from './DataSettings';

const meta: Meta<typeof DataSettings> = {
  component: DataSettings,
  decorators: [withFakeLibrary],
  args: { onDeviceChange: () => {} },
};

export default meta;
type Story = StoryObj<typeof DataSettings>;

/** A library whose originals are elsewhere: this device keeps copies of them. */
export const KeepsCopies: Story = { args: { device: { deviceName: 'Studio laptop', cacheBytes: 3_400_000_000 } } };

/** A library in this browser: nothing extra is kept. */
export const InThisBrowser: Story = { args: { device: { deviceName: 'Studio laptop', cacheBytes: null } } };
