import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { ViewBar } from './ViewBar';

const IDS = ['a', 'b', 'c', 'd', 'e'];

const meta: Meta<typeof ViewBar> = {
  component: ViewBar,
  decorators: [withFakeLibrary],
  args: { orderedIds: IDS },
};

export default meta;
type Story = StoryObj<typeof ViewBar>;

/** Under the gallery: the size slider at the left, the views at the right, Grid on. */
export const UnderTheGallery: Story = {};

/** A gallery of one photo has nothing to put side by side. */
export const OnePhoto: Story = { args: { orderedIds: ['a'] } };
