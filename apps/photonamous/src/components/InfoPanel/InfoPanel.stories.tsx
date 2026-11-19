import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { selectOne } from '../../library/selection';
import { InfoPanel } from './InfoPanel';

const meta: Meta<typeof InfoPanel> = {
  component: InfoPanel,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof InfoPanel>;

const [first] = fakeAssetIds(1);

export const OnePhoto: Story = {
  render: () => {
    useUi.getState().setSelection(selectOne(first ?? ''));
    return <InfoPanel />;
  },
};
