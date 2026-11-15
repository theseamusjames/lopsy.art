import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SnapAnchorPicker } from './SnapAnchorPicker';
import { DEFAULT_SNAP_ANCHOR } from '../../tools/move/snap-anchor';
import type { SnapAnchor } from '../../tools/move/snap-anchor';

const meta: Meta<typeof SnapAnchorPicker> = {
  component: SnapAnchorPicker,
};

export default meta;
type Story = StoryObj<typeof SnapAnchorPicker>;

function Interactive({ initial, disabled }: { initial: SnapAnchor; disabled?: boolean }) {
  const [anchor, setAnchor] = useState(initial);
  return (
    <SnapAnchorPicker
      anchor={anchor}
      disabled={disabled}
      onHorizontalChange={(horizontal) => setAnchor((a) => ({ ...a, horizontal }))}
      onVerticalChange={(vertical) => setAnchor((a) => ({ ...a, vertical }))}
    />
  );
}

export const Default: Story = {
  render: () => <Interactive initial={DEFAULT_SNAP_ANCHOR} />,
};

export const Centered: Story = {
  render: () => <Interactive initial={{ horizontal: 'center', vertical: 'middle' }} />,
};

export const Disabled: Story = {
  render: () => <Interactive initial={DEFAULT_SNAP_ANCHOR} disabled />,
};
