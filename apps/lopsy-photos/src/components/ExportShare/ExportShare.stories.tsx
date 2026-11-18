import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { fakeLibrary } from '../../stories/fake-library';
import { ExportShare } from './ExportShare';

const meta: Meta<typeof ExportShare> = {
  component: ExportShare,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ExportShare>;

export const Default: Story = {
  render: () => (
    <ExportShare session={fakeLibrary()} folder={{ id: 'exports-1', name: 'Coast', webLink: 'https://example.com/folder/coast' }} photoCount={12} />
  ),
};
