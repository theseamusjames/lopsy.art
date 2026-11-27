import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { DevelopProfile } from '../../engine/profiles';
import { ProfileMenu, type ProfileMenuProps } from './ProfileMenu';

const meta: Meta<typeof ProfileMenu> = {
  component: ProfileMenu,
};

export default meta;
type Story = StoryObj<typeof ProfileMenu>;

const PROFILES: readonly DevelopProfile[] = [
  { id: 'camera', name: 'Camera' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'monochrome', name: 'Monochrome' },
];

function Controlled(props: Omit<ProfileMenuProps, 'profileId' | 'onSelect' | 'profiles'>) {
  const [profileId, setProfileId] = useState('camera');
  return <ProfileMenu {...props} profiles={PROFILES} profileId={profileId} onSelect={(p) => setProfileId(p.id)} />;
}

export const Default: Story = {
  render: () => <Controlled isDisabled={false} />,
};

export const WithColorNote: Story = {
  render: () => (
    <Controlled
      isDisabled={false}
      note="Colour is approximate: this Sony RAW carries only part of the camera's colour matrix, so colours look less saturated than in the camera's own JPEG."
    />
  ),
};

export const Disabled: Story = {
  render: () => <Controlled isDisabled />,
};
