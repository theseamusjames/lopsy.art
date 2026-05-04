import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { NavigatorPanel } from './NavigatorPanel';
import { useEditorStore } from '../../app/editor-store';

const meta: Meta<typeof NavigatorPanel> = {
  component: NavigatorPanel,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--color-bg-secondary)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NavigatorPanel>;

function WithDocumentState({ zoom, panX, panY, children }: {
  zoom: number;
  panX: number;
  panY: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const store = useEditorStore.getState();
    store.setZoom(zoom);
    store.setPan(panX, panY);
    store.setViewportSize(800, 600);
  }, [zoom, panX, panY]);
  return <>{children}</>;
}

export const Default: Story = {
  render: () => (
    <WithDocumentState zoom={1} panX={0} panY={0}>
      <NavigatorPanel />
    </WithDocumentState>
  ),
};

export const ZoomedIn: Story = {
  render: () => (
    <WithDocumentState zoom={3} panX={0} panY={0}>
      <NavigatorPanel />
    </WithDocumentState>
  ),
};

export const ZoomedOut: Story = {
  render: () => (
    <WithDocumentState zoom={0.25} panX={0} panY={0}>
      <NavigatorPanel />
    </WithDocumentState>
  ),
};

export const PannedTopLeft: Story = {
  render: () => (
    <WithDocumentState zoom={2} panX={200} panY={150}>
      <NavigatorPanel />
    </WithDocumentState>
  ),
};
