import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  component: EmptyState,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const EmptyLibrary: Story = { args: { libraryEmpty: true, collection: { kind: 'all' }, searching: false } };
/** A device's first sync of a library that may well have photos: not "empty" yet. */
export const SettingUp: Story = { args: { libraryEmpty: true, collection: { kind: 'all' }, searching: false, setup: { kind: 'setting-up' } } };
export const WaitingForStorage: Story = {
  args: {
    libraryEmpty: true,
    collection: { kind: 'all' },
    searching: false,
    setup: { kind: 'waiting', reason: 'Your storage can’t be reached right now. Photonamous will keep trying.' },
  },
};
export const NothingFound: Story = { args: { libraryEmpty: false, collection: { kind: 'all' }, searching: true } };
export const EmptySetAside: Story = { args: { libraryEmpty: false, collection: { kind: 'set-aside' }, searching: false } };
