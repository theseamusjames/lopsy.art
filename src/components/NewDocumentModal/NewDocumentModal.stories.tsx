import type { Meta, StoryObj } from '@storybook/react-vite';
import { NewDocumentModal } from './NewDocumentModal';

const meta: Meta<typeof NewDocumentModal> = {
  component: NewDocumentModal,
  parameters: { layout: 'fullscreen' },
  args: {
    onCreateDocument: (w, h, bg) => console.log('create', w, h, bg),
    onOpenFile: (f) => console.log('open file', f.name),
  },
};

export default meta;
type Story = StoryObj<typeof NewDocumentModal>;

export const Default: Story = {};

export const Dismissible: Story = {
  args: { onCancel: () => console.log('cancel') },
};
