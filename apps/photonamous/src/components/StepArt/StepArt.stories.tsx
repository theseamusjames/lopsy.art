import type { Meta, StoryObj } from '@storybook/react-vite';
import { StepArt } from './StepArt';

const meta: Meta<typeof StepArt> = {
  component: StepArt,
  args: { step: 'connect' },
  decorators: [
    (Story) => (
      <div style={{ width: 260 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StepArt>;

/** One folder Photonamous may use, between two it may not. */
export const Connect: Story = {};

/** Photos going up into the visitor's own cloud. */
export const Upload: Story = { args: { step: 'upload' } };

/** A photo under the before-and-after divider. */
export const Edit: Story = { args: { step: 'edit' } };
