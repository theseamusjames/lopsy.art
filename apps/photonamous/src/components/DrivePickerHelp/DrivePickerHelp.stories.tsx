import type { Meta, StoryObj } from '@storybook/react-vite';
import { DrivePickerHelp } from './DrivePickerHelp';

const meta: Meta<typeof DrivePickerHelp> = {
  component: DrivePickerHelp,
  args: { onOpenWindow: () => {} },
};

export default meta;
type Story = StoryObj<typeof DrivePickerHelp>;

/** As it sits under Google's Picker: along the bottom of the window. */
export const UnderThePicker: Story = {};
