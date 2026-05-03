import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { ArtboardsPanel } from './ArtboardsPanel';
import { useEditorStore } from '../../app/editor-store';

const meta: Meta<typeof ArtboardsPanel> = {
  component: ArtboardsPanel,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ArtboardsPanel>;

function Seeded({ seed }: { seed: () => void }) {
  useEffect(() => {
    seed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ArtboardsPanel />;
}

export const Empty: Story = {
  render: () => (
    <Seeded
      seed={() => {
        useEditorStore.setState({ artboards: [] });
      }}
    />
  ),
};

export const WithArtboards: Story = {
  render: () => (
    <Seeded
      seed={() => {
        useEditorStore.setState({
          artboards: [
            { id: 'ab-1', name: 'Home', x: 0, y: 0, width: 1440, height: 900 },
            { id: 'ab-2', name: 'Mobile', x: 1500, y: 0, width: 390, height: 844 },
            { id: 'ab-3', name: 'Tablet', x: 3000, y: 0, width: 768, height: 1024 },
          ],
        });
      }}
    />
  ),
};
