import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Disclosure } from './Disclosure';

const meta: Meta<typeof Disclosure> = {
  component: Disclosure,
};

export default meta;
type Story = StoryObj<typeof Disclosure>;

export const Default: Story = {
  render: function Story() {
    const [open, setOpen] = useState(false);
    return <Disclosure open={open} onToggle={() => setOpen((o) => !o)} />;
  },
};
export const Open: Story = { args: { open: true, onToggle: () => undefined } };
