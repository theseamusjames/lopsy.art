import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBar, StatusDivider, StatusItem, StatusNumber, StatusSpacer } from './StatusBar';

const meta: Meta<typeof StatusBar> = {
  component: StatusBar,
};

export default meta;
type Story = StoryObj<typeof StatusBar>;

/** Readings at the left, the engine and the display at the right, as both apps lay it out. */
export const Default: Story = {
  render: () => (
    <StatusBar>
      <StatusItem name="Photo size">
        <StatusNumber>6240</StatusNumber> × <StatusNumber>4160</StatusNumber> px
      </StatusItem>
      <StatusDivider />
      <StatusItem name="Editing at">
        <StatusNumber>3072</StatusNumber> × <StatusNumber>2048</StatusNumber> px
      </StatusItem>
      <StatusSpacer />
      <StatusItem name="Renderer">WebGPU</StatusItem>
      <StatusDivider />
      <StatusItem name="Display">Display P3</StatusItem>
    </StatusBar>
  ),
};

/** A state worth noticing is in the primary text colour, as Lopsy shows a colour mode other than RGB. */
export const Emphasized: Story = {
  render: () => (
    <StatusBar>
      <StatusSpacer />
      <StatusItem isEmphasized>Lab</StatusItem>
      <StatusDivider />
      <StatusItem name="Renderer">WebGL 8-bit</StatusItem>
      <StatusDivider />
      <StatusItem name="Display">sRGB</StatusItem>
    </StatusBar>
  ),
};
