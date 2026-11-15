import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { TextPanel } from './TextPanel';
import { useToolSettingsStore } from '../../app/tool-settings-store';

const meta: Meta<typeof TextPanel> = {
  component: TextPanel,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--color-bg-secondary)', padding: 12 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TextPanel>;

function WithRecentFonts({ fonts, children }: { fonts: string[]; children: React.ReactNode }) {
  useEffect(() => {
    useToolSettingsStore.setState({ recentFonts: fonts });
  }, [fonts]);
  return <>{children}</>;
}

export const Default: Story = {
  render: () => (
    <WithRecentFonts fonts={[]}>
      <TextPanel />
    </WithRecentFonts>
  ),
};

export const WithRecentFontList: Story = {
  render: () => (
    <WithRecentFonts fonts={['Inter', 'Roboto', 'Oswald', 'Playfair Display']}>
      <TextPanel />
    </WithRecentFonts>
  ),
};
