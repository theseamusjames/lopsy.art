import type { Meta, StoryObj } from '@storybook/react-vite';
import { BUILT_IN_EXPORT_PRESETS } from '@lopsy/photos-core/library/presets';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { ExportPresetBar } from './ExportPresetBar';

const meta: Meta<typeof ExportPresetBar> = {
  component: ExportPresetBar,
};

export default meta;
type Story = StoryObj<typeof ExportPresetBar>;

const mine = { id: 'mine', name: 'Print, full size', settings: DEFAULT_EXPORT_SETTINGS, createdAt: '', deleted: false };

export const BuiltIn: Story = {
  args: { presets: [...BUILT_IN_EXPORT_PRESETS, mine], selectedId: BUILT_IN_EXPORT_PRESETS[0]?.id ?? null, disabled: false, onPick: () => undefined, onSave: () => undefined, onRename: () => undefined, onDelete: () => undefined },
};
export const Yours: Story = { args: { ...BuiltIn.args, selectedId: 'mine' } };
export const ByHand: Story = { args: { ...BuiltIn.args, selectedId: null } };
