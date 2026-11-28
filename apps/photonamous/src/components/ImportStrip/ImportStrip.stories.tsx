import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ImportItem, ImportJob, ImportProgress } from '@lopsy/photos-core/import/types';
import { useUi } from '../../app/store';
import { withFakeLibrary } from '../../stories/fake-library';
import { ImportStrip } from './ImportStrip';

const meta: Meta<typeof ImportStrip> = {
  component: ImportStrip,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ImportStrip>;

export const Default: Story = {};

/** A job that stays where it is, for showing one state of the strip. */
function stillJob(progress: ImportProgress): ImportJob {
  return {
    id: 'story-import',
    getProgress: () => progress,
    subscribe: () => () => {},
    cancel: () => {},
    pause: () => {},
    finished: new Promise<ImportProgress>(() => {}),
  };
}

function items(done: number, total: number): ImportItem[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `f${i}`,
    fileName: `DSCF${String(1000 + i)}.RAF`,
    byteSize: 50_000_000,
    state: i < done ? 'done' : 'staged',
    sentBytes: i < done ? 50_000_000 : 0,
    assetId: null,
    error: null,
  }));
}

/** The token ran out and Google's window needs a click: the import waits for Reconnect. */
export const WaitingForSignIn: Story = {
  decorators: [
    (Story) => {
      useUi.getState().setImportJob(stillJob({ items: items(288, 700), finished: false, needsSignIn: true }));
      return <Story />;
    },
  ],
};
