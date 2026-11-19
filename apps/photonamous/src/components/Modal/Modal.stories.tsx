import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button/Button';
import { Modal } from './Modal';

const meta: Meta<typeof Modal> = {
  component: Modal,
  args: { title: 'Move 2 photos to the trash?', onClose: () => undefined },
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const Default: Story = {
  args: {
    children: <p>Their originals and previews go to the trash, where they can be restored.</p>,
    footer: (
      <>
        <Button>Keep them</Button>
        <Button variant="danger">Move to the trash</Button>
      </>
    ),
  },
};
export const Small: Story = { args: { width: 'sm', title: 'New version', children: <p>A short dialog.</p> } };
export const Large: Story = { args: { width: 'lg', title: 'Export 3 photos', children: <p>A wide dialog.</p> } };
