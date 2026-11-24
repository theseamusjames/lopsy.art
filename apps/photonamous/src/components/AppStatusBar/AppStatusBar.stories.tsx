import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBarContent } from './AppStatusBar';

const meta: Meta<typeof StatusBarContent> = {
  component: StatusBarContent,
  args: {
    status: { renderer: 'wgpu', isEightBit: false, display: { isDisplayP3: true, isHdr: false } },
    editSizes: null,
    isEditing: false,
    shownCount: 1234,
    selectedCount: 0,
  },
};

export default meta;
type Story = StoryObj<typeof StatusBarContent>;

/** The library: how many photos are shown. */
export const Library: Story = {};

/** The library with photos selected. */
export const Selected: Story = { args: { selectedCount: 12 } };

/** The Edit view: the photo's size and the working size it is edited at. */
export const Editing: Story = {
  args: { isEditing: true, editSizes: { photo: { width: 6240, height: 4160 }, working: { width: 3072, height: 2045 } } },
};

/** A GPU without float render targets: photos are developed with the baked look in 8 bits, on an sRGB display. */
export const EightBit: Story = {
  args: { status: { renderer: 'webgl', isEightBit: true, display: { isDisplayP3: false, isHdr: false } } },
};
