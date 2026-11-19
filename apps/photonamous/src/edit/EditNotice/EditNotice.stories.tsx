import type { Meta, StoryObj } from '@storybook/react-vite';
import { Paintbrush } from 'lucide-react';
import { EditNotice } from './EditNotice';

const meta: Meta<typeof EditNotice> = {
  component: EditNotice,
};

export default meta;
type Story = StoryObj<typeof EditNotice>;

export const LopsyDocument: Story = {
  args: {
    heading: 'DSCF8534 (1).lopsy',
    documentTitle: 'DSCF8534 (1).lopsy – Lopsy document – Photonamous',
    children: 'This is a Lopsy document. It opens in Lopsy, not in the Edit view.',
    action: { label: 'Open in Lopsy', icon: <Paintbrush size={14} />, onClick: () => undefined },
    onClose: () => undefined,
  },
};

export const NotInTheLibrary: Story = {
  args: {
    heading: 'This photo is no longer in the library',
    documentTitle: 'Not in the library – Photonamous',
    onClose: () => undefined,
  },
};
