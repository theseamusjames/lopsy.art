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
export const NothingFound: Story = { args: { libraryEmpty: false, collection: { kind: 'all' }, searching: true } };
export const EmptySetAside: Story = { args: { libraryEmpty: false, collection: { kind: 'set-aside' }, searching: false } };
