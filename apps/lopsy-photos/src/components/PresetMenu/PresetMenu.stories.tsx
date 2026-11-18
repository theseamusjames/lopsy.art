import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { PresetMenu } from './PresetMenu';

const meta: Meta<typeof PresetMenu> = {
  component: PresetMenu,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof PresetMenu>;

export const Default: Story = { args: { disabled: false } };
export const Disabled: Story = { args: { disabled: true } };
