import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FontPicker } from './FontPicker';
import { useLocalFontsStore, type LocalFontsStatus } from '../../app/local-fonts-store';
import { groupLocalFontFaces, type LocalFontFace } from '../../utils/local-fonts';

const meta: Meta<typeof FontPicker> = {
  component: FontPicker,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof FontPicker>;

const INSTALLED_FACES: readonly LocalFontFace[] = [
  { family: 'Avenida Std', fullName: 'Avenida Std', postscriptName: 'AvenidaStd', style: 'Regular' },
  { family: 'Helvetica Neue', fullName: 'Helvetica Neue', postscriptName: 'HelveticaNeue', style: 'Regular' },
  { family: 'Helvetica Neue', fullName: 'Helvetica Neue Bold', postscriptName: 'HelveticaNeue-Bold', style: 'Bold' },
  { family: 'Helvetica Neue', fullName: 'Helvetica Neue Light Italic', postscriptName: 'HelveticaNeue-LightItalic', style: 'Light Italic' },
  { family: 'Menlo', fullName: 'Menlo Regular', postscriptName: 'Menlo-Regular', style: 'Regular' },
  { family: 'Arial', fullName: 'Arial', postscriptName: 'ArialMT', style: 'Regular' },
];

function seedLocalFonts(status: LocalFontsStatus, faces: readonly LocalFontFace[]): void {
  const entries = groupLocalFontFaces(faces);
  useLocalFontsStore.setState({
    status,
    entries,
    byFamily: new Map(entries.map((e) => [e.family, e])),
    error: null,
  });
}

export const Default: Story = {
  render: () => {
    const [font, setFont] = useState(() => {
      seedLocalFonts('idle', []);
      return 'Inter';
    });
    return <FontPicker value={font} onChange={setFont} />;
  },
};

export const WithMonospace: Story = {
  render: () => {
    const [font, setFont] = useState(() => {
      seedLocalFonts('idle', []);
      return 'JetBrains Mono';
    });
    return <FontPicker value={font} onChange={setFont} />;
  },
};

/** Installed fonts lead the list under a "Local" header; "Arial" shadows the catalog's row. */
export const WithLocalFonts: Story = {
  render: () => {
    const [font, setFont] = useState(() => {
      seedLocalFonts('ready', INSTALLED_FACES);
      return "'Avenida Std', sans-serif";
    });
    return <FontPicker value={font} onChange={setFont} />;
  },
};

/** The browser refused (or the user dismissed) the permission prompt: a manual load button is offered. */
export const LocalFontsDenied: Story = {
  render: () => {
    const [font, setFont] = useState(() => {
      seedLocalFonts('failed', []);
      return 'Inter';
    });
    return <FontPicker value={font} onChange={setFont} />;
  },
};
