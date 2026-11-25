import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Cloud, Download, FolderOpen, Images, Trash2 } from 'lucide-react';
import { useMenuKeys } from '../a11y/use-menu-keys';
import { Menu, MenuGroup, MenuItem, MenuSeparator } from './Menu';

const meta: Meta<typeof Menu> = {
  component: Menu,
};

export default meta;
type Story = StoryObj<typeof Menu>;

function Demo({ withGroups }: { readonly withGroups: boolean }) {
  const [isOpen, setIsOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keys = useMenuKeys({ isOpen, onClose: () => setIsOpen(false), onOpen: () => setIsOpen(true), triggerRef });
  const choose = () => setIsOpen(false);
  return (
    <div>
      <button ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((o) => !o)} onKeyDown={keys.onTriggerKeyDown}>
        Import photos
      </button>
      {isOpen && (
        <Menu keys={keys} label="Import photos" note="You can also drop photos or a folder anywhere on the window.">
          <MenuItem icon={<Images size={16} />} detail="Pick one or more files" onSelect={choose}>
            Choose photos…
          </MenuItem>
          <MenuItem icon={<FolderOpen size={16} />} detail="Everything in it, including folders inside" onSelect={choose}>
            Choose a folder…
          </MenuItem>
          <MenuItem icon={<Cloud size={16} />} detail="Sign in to Google Drive first" disabled onSelect={choose}>
            Add from Google Drive…
          </MenuItem>
          {withGroups && (
            <>
              <MenuSeparator />
              <MenuGroup label="This photo">
                <MenuItem icon={<Download size={16} />} onSelect={choose}>
                  Export…
                </MenuItem>
                <MenuItem icon={<Trash2 size={16} />} onSelect={choose}>
                  Move to the trash…
                </MenuItem>
              </MenuGroup>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

export const Default: Story = { render: () => <Demo withGroups={false} /> };
export const WithGroups: Story = { render: () => <Demo withGroups /> };
