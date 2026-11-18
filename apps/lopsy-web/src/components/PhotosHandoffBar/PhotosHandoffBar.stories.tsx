import type { Meta, StoryObj } from '@storybook/react-vite';
import { PhotosHandoffBar } from './PhotosHandoffBar';

const meta: Meta<typeof PhotosHandoffBar> = {
  component: PhotosHandoffBar,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'DSCF1234',
    status: { kind: 'idle' },
    onSave: () => {},
    onBack: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PhotosHandoffBar>;

export const Idle: Story = {};

export const Saving: Story = {
  args: { status: { kind: 'saving' } },
};

export const Saved: Story = {
  args: { status: { kind: 'saved' } },
};

export const Failed: Story = {
  args: { status: { kind: 'failed', reason: 'Lopsy Photos did not confirm the save in time.' } },
};
