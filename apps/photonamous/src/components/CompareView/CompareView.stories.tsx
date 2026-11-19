import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { CompareView } from './CompareView';

const meta: Meta<typeof CompareView> = {
  component: CompareView,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof CompareView>;

const ids = fakeAssetIds(24);

export const Default: Story = {
  render: () => {
    useUi.getState().setSelection({ ids: new Set(ids.slice(0, 3)), anchor: ids[0] ?? null, focus: ids[0] ?? null });
    return <div style={{ height: 560, display: 'flex' }}><CompareView orderedIds={ids} /></div>;
  },
};
