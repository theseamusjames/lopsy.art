import type { Meta, StoryObj } from '@storybook/react-vite';
import { COPY_GROUPS, DEFAULT_COPY_GROUP_IDS } from '../../library/recipe-copy';
import { CopyEditsDialog } from './CopyEditsDialog';

const meta: Meta<typeof CopyEditsDialog> = {
  component: CopyEditsDialog,
};

export default meta;
type Story = StoryObj<typeof CopyEditsDialog>;

export const Default: Story = {
  args: { sourceName: 'harbour.jpg', groups: COPY_GROUPS, initial: DEFAULT_COPY_GROUP_IDS, onCopy: () => undefined, onClose: () => undefined },
};
