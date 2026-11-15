import { useMemo } from 'react';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { textColorDisplay, type TextColorDisplay } from '../../tools/text/apply-text-color';
import type { TextLayer } from '../../types';

/** What the text colour control shows for the edited / selected text (#1154). */
export function useTextColor(): TextColorDisplay {
  const editing = useUIStore((s) => s.textEditing);
  const foreground = useToolSettingsStore((s) => s.foregroundColor);
  const layer = useEditorStore((s): TextLayer | null => {
    const l = s.document.layers.find((x) => x.id === s.document.activeLayerId);
    return l?.type === 'text' ? l : null;
  });
  return useMemo(() => textColorDisplay(editing, layer, foreground), [editing, layer, foreground]);
}
