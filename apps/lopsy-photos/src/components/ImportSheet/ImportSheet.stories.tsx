import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { ImportSheet } from './ImportSheet';

const meta: Meta<typeof ImportSheet> = {
  component: ImportSheet,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ImportSheet>;

function pick(names: readonly string[]): File[] {
  return names.map((name) => new File([new Uint8Array(2048)], name, { type: name.endsWith('.RAF') ? 'image/x-fuji-raf' : 'image/jpeg' }));
}

export const PhotosAndAPair: Story = {
  render: () => {
    useUi.setState({ pendingImport: pick(['DSCF0001.RAF', 'DSCF0001.JPG', 'harbour.jpg', 'notes.txt']), importJob: null });
    return <ImportSheet />;
  },
};
