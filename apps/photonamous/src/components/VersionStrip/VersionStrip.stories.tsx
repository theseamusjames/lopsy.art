import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, fakeLibrary, withFakeLibrary } from '../../stories/fake-library';
import { versionsByAsset } from '../../library/items';
import { VersionStrip } from './VersionStrip';

const meta: Meta<typeof VersionStrip> = {
  component: VersionStrip,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof VersionStrip>;

const [first, second, third] = fakeAssetIds(3);

/** Gives a story photo `count` versions in all. The story library is shared, so only the ones it lacks are made. */
function withVersions(assetId: string, count: number): void {
  const library = fakeLibrary();
  const have = versionsByAsset(library.getView()).get(assetId)?.length ?? 0;
  for (let n = have + 1; n <= count; n++) library.createVersion(assetId, n % 2 === 0 ? `Warm evening ${n}` : `Version ${n}`);
}

export const Default: Story = { args: { itemId: first ?? '' } };

/** Four versions in a narrow row: the chips scroll sideways on their own. */
export const ScrollingChips: Story = {
  args: { itemId: second ?? '' },
  loaders: [() => withVersions(second ?? '', 4)],
  decorators: [
    (Story) => (
      <div style={{ width: 360, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
};

/** More than four: a dropdown, with the chosen version's actions beside it. */
export const Dropdown: Story = {
  args: { itemId: third ?? '' },
  loaders: [() => withVersions(third ?? '', 6)],
};
