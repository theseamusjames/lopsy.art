import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  component: Button,
  args: { children: 'Export', onClick: () => undefined },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Secondary: Story = {};
export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost', size: 'sm' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Move to the trash' } };
export const Link: Story = {
  args: {
    variant: 'link',
    size: 'sm',
    children: (
      <>
        <ArrowLeft size={14} />
        Back to the grid
      </>
    ),
  },
};
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const Busy: Story = { args: { variant: 'primary', 'aria-disabled': true, children: 'Checking…' } };
export const WithIcon: Story = {
  args: {
    size: 'sm',
    children: (
      <>
        <Download size={14} />
        Export
      </>
    ),
  },
};
