import type { BlendMode } from '../../types';
import { HSL_BLEND_MODES } from '../../utils/color-mode-capabilities';

export interface BlendModeGroup {
  label: string;
  modes: BlendMode[];
}

// Grouping is a UX choice, not a Rust-side concept — the engine treats all
// blend modes uniformly.
const BLEND_MODE_GROUPS: BlendModeGroup[] = [
  { label: 'Normal', modes: ['normal'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'color-burn'] },
  { label: 'Lighten', modes: ['lighten', 'screen', 'color-dodge'] },
  { label: 'Contrast', modes: ['overlay', 'soft-light', 'hard-light'] },
  { label: 'Comparative', modes: ['difference', 'exclusion'] },
  { label: 'Composite', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];

// Pass Through is only valid on group layers and appears at the top of the list.
const GROUP_BLEND_MODE_GROUPS: BlendModeGroup[] = [
  { label: 'Pass Through', modes: ['pass-through'] },
  ...BLEND_MODE_GROUPS,
];

export function blendModeGroupsFor(isGroup: boolean, allowHsl: boolean): BlendModeGroup[] {
  return (isGroup ? GROUP_BLEND_MODE_GROUPS : BLEND_MODE_GROUPS)
    .map((group) => ({ ...group, modes: group.modes.filter((m) => allowHsl || !HSL_BLEND_MODES.has(m)) }))
    .filter((group) => group.modes.length > 0);
}
