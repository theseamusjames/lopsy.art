import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { SingleView } from './SingleView';

const meta: Meta<typeof SingleView> = {
  component: SingleView,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof SingleView>;

const ids = fakeAssetIds(24);

export const Default: Story = {
  render: () => {
    useUi.getState().setSelection({ ids: new Set(ids.slice(0, 1)), anchor: ids[0] ?? null, focus: ids[0] ?? null });
    return <div style={{ height: 560, display: 'flex' }}><SingleView orderedIds={ids} /></div>;
  },
};

/** At 320 px the bars wrap: the edit buttons under the labels and stars, Set aside under the versions. */
export const Narrow: Story = {
  render: () => {
    useUi.getState().setSelection({ ids: new Set(ids.slice(0, 1)), anchor: ids[0] ?? null, focus: ids[0] ?? null });
    return <div style={{ width: 320, height: 640, display: 'flex' }}><SingleView orderedIds={ids} /></div>;
  },
};
