import type { Meta, StoryObj } from '@storybook/react-vite';
import { BINS } from '../histogram';
import { ClippingButtons } from './ClippingButtons';

const meta: Meta<typeof ClippingButtons> = {
  component: ClippingButtons,
};

export default meta;
type Story = StoryObj<typeof ClippingButtons>;

/** Every channel in the midtones, with `atBlack` and `atWhite` pixels of each at the ends. */
function bins(atBlack: number, atWhite: number): Uint32Array {
  const out = new Uint32Array(BINS * 4);
  for (let c = 0; c < 4; c++) {
    out[c * BINS] = atBlack;
    out[c * BINS + 128] = 1000 - atBlack - atWhite;
    out[c * BINS + BINS - 1] = atWhite;
  }
  return out;
}

export const NothingClips: Story = {
  args: { bins: bins(0, 0) },
};

export const ShadowsClip: Story = {
  args: { bins: bins(40, 0) },
};

export const HighlightsClip: Story = {
  args: { bins: bins(0, 40) },
};

export const BothClip: Story = {
  args: { bins: bins(40, 40) },
};

export const BeforeTheFirstRead: Story = {
  args: { bins: null },
};

export const Disabled: Story = {
  args: { bins: bins(40, 40), isDisabled: true },
};
