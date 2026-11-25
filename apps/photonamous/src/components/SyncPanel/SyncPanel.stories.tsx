import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { SyncPanel } from './SyncPanel';

const meta: Meta<typeof SyncPanel> = {
  component: SyncPanel,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof SyncPanel>;

export const Default: Story = {};
