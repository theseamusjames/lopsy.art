import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { LeftoverAction } from './LeftoverAction';

const meta: Meta<typeof LeftoverAction> = {
  component: LeftoverAction,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof LeftoverAction>;

export const TwoLeftovers: Story = { args: { leftovers: ['file-a', 'file-b'], onDone: () => undefined } };
