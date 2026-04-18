import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const meta: Meta<typeof ContextMenu> = {
  component: ContextMenu,
};

export default meta;
type Story = StoryObj<typeof ContextMenu>;

const layerItems: ContextMenuItem[] = [
  { label: 'Duplicate layer', action: () => console.log('duplicate') },
  { label: 'Delete layer', action: () => console.log('delete') },
  { label: '', action: () => {}, separator: true },
  { label: 'Merge down', action: () => console.log('merge') },
  { label: 'Flatten image', action: () => console.log('flatten'), disabled: true },
];

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    if (!open) {
      return (
        <button type="button" onClick={() => setOpen(true)}>
          Reopen menu
        </button>
      );
    }
    return (
      <div style={{ height: 300, position: 'relative' }}>
        <ContextMenu items={layerItems} x={40} y={40} onClose={() => setOpen(false)} />
      </div>
    );
  },
};

export const NearRightEdge: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    if (!open) return <button type="button" onClick={() => setOpen(true)}>Reopen</button>;
    return (
      <div style={{ height: 300, position: 'relative' }}>
        <ContextMenu
          items={layerItems}
          x={typeof window !== 'undefined' ? window.innerWidth - 20 : 800}
          y={40}
          onClose={() => setOpen(false)}
        />
      </div>
    );
  },
};
