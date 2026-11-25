import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { PhotoTile } from './PhotoTile';

const meta: Meta<typeof PhotoTile> = {
  component: PhotoTile,
  decorators: [withFakeLibrary, (Story) => <div style={{ width: 220, height: 220, display: 'grid' }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof PhotoTile>;

const [first, second] = fakeAssetIds(2);

export const Default: Story = { args: { assetId: first ?? '', column: 1, selected: false, focused: false, tabbable: false, onPick: () => undefined, onOpen: () => undefined } };
export const Selected: Story = { args: { assetId: second ?? '', column: 2, selected: true, focused: true, tabbable: true, onPick: () => undefined, onOpen: () => undefined } };
