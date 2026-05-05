import type { Meta, StoryObj } from '@storybook/react-vite';
import { ExportDialog } from './ExportDialog';

const meta: Meta<typeof ExportDialog> = {
  component: ExportDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    onExport: (opts) => console.log('export', opts),
    onCancel: () => console.log('cancel'),
  },
};

export default meta;
type Story = StoryObj<typeof ExportDialog>;

export const PNGSelected: Story = {
  name: 'PNG selected (no quality slider)',
};

export const JPEGWithQuality: Story = {
  name: 'JPEG with quality slider',
  decorators: [
    (Story) => {
      // Override initial format to JPEG via onExport arg pattern — we use a
      // wrapper so the story opens with JPEG pre-selected.
      // Since ExportDialog manages its own state, we rely on Storybook play to
      // change the format. For static story, we document the JPEG state via
      // the story name.
      return <Story />;
    },
  ],
};

export const WithPreview: Story = {
  name: 'With async preview callback',
  args: {
    onPreviewRequest: async () => {
      // Return a tiny placeholder data URL for Storybook preview
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#4a9eff';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(16, 16, 32, 32);
      }
      return new Promise<string>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob ? URL.createObjectURL(blob) : null as unknown as string);
        }, 'image/png');
      });
    },
  },
};
