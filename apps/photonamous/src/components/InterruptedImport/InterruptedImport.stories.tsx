import type { Meta, StoryObj } from '@storybook/react-vite';
import { useUi } from '../../app/store';
import { withFakeLibrary } from '../../stories/fake-library';
import { InterruptedImport } from './InterruptedImport';

const meta: Meta<typeof InterruptedImport> = {
  component: InterruptedImport,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof InterruptedImport>;

/** Nothing was interrupted: the notice renders nothing. */
export const Default: Story = {};

/** A reload interrupted a 700-file import; 412 files were never staged on this device. */
export const AfterAReload: Story = {
  decorators: [
    (Story) => {
      useUi.getState().setInterruptedImport({
        total: 700,
        imported: 288,
        missing: Array.from({ length: 412 }, (_, i) => ({ fileName: `DSCF${String(5288 + i)}.RAF`, byteSize: 52_000_000, lastModified: 0 })),
      });
      return <Story />;
    },
  ],
};
