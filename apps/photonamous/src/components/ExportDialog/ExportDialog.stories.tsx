import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { selectOne } from '../../library/selection';
import { ExportDialog } from './ExportDialog';

const meta: Meta<typeof ExportDialog> = {
  component: ExportDialog,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ExportDialog>;

const [first] = fakeAssetIds(1);

export const OnePhoto: Story = {
  render: () => {
    useUi.getState().setSelection(selectOne(first ?? ''));
    return <ExportDialog />;
  },
};
