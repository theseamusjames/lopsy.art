import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyPlus, Layers, Paintbrush } from 'lucide-react';
import { MoreMenu } from './MoreMenu';

const meta: Meta<typeof MoreMenu> = {
  component: MoreMenu,
};

export default meta;
type Story = StoryObj<typeof MoreMenu>;

export const Default: Story = {
  args: {
    items: [
      { label: 'New version', hint: 'Another edit of this photo, the original untouched', icon: <CopyPlus size={14} />, run: () => undefined },
      { label: 'Edit in Lopsy', hint: 'Select one photo first', icon: <Paintbrush size={14} />, disabled: true, run: () => undefined },
      { label: 'Group bursts', hint: 'Shots taken in quick succession show as one', icon: <Layers size={14} />, checked: true, run: () => undefined },
    ],
  },
  decorators: [(Story) => <div style={{ display: 'flex', justifyContent: 'flex-end', height: 260 }}><Story /></div>],
};
