import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toolRegistry } from '../../tools/tool-registry';

/**
 * Action IDs for non-tool shortcuts that can be customized.
 * Tool shortcuts use the tool's id (e.g. 'brush', 'eraser').
 */
export const NON_TOOL_ACTION_IDS = [
  'swap-colors',
  'reset-colors',
  'toggle-quick-mask',
] as const;

export type NonToolActionId = (typeof NON_TOOL_ACTION_IDS)[number];

/** The default key for each non-tool action. */
export const NON_TOOL_DEFAULTS: Record<NonToolActionId, string> = {
  'swap-colors': 'x',
  'reset-colors': 'd',
  'toggle-quick-mask': 'q',
};

/** Returns all action IDs that are customizable (tools + non-tool actions). */
export function getAllActionIds(): string[] {
  const toolIds = Object.values(toolRegistry)
    .filter((d) => d.shortcut !== undefined)
    .map((d) => d.id);
  return [...toolIds, ...NON_TOOL_ACTION_IDS];
}

/** Returns the default key for any action ID. */
export function getDefaultKey(actionId: string): string | undefined {
  const descriptor = toolRegistry[actionId as keyof typeof toolRegistry];
  if (descriptor?.shortcut) return descriptor.shortcut;
  if (actionId in NON_TOOL_DEFAULTS) {
    return NON_TOOL_DEFAULTS[actionId as NonToolActionId];
  }
  return undefined;
}

interface ShortcutStore {
  /** Custom overrides — action ID → lower-cased single key. */
  customShortcuts: Record<string, string>;
  /**
   * Set a custom key binding for an action. Pass the raw `e.key` value
   * (will be lower-cased internally).
   */
  setShortcut: (actionId: string, key: string) => void;
  /** Remove the custom override and fall back to the default. */
  resetShortcut: (actionId: string) => void;
  /** Remove all custom overrides. */
  resetAllShortcuts: () => void;
  /**
   * Return the active key for an action ID — custom if set, otherwise default.
   * Returns undefined if the action is not found.
   */
  getKey: (actionId: string) => string | undefined;
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set, get) => ({
      customShortcuts: {},

      setShortcut: (actionId, key) =>
        set((state) => ({
          customShortcuts: { ...state.customShortcuts, [actionId]: key.toLowerCase() },
        })),

      resetShortcut: (actionId) =>
        set((state) => {
          const next = { ...state.customShortcuts };
          delete next[actionId];
          return { customShortcuts: next };
        }),

      resetAllShortcuts: () => set({ customShortcuts: {} }),

      getKey: (actionId) => {
        const custom = get().customShortcuts[actionId];
        if (custom !== undefined) return custom;
        return getDefaultKey(actionId);
      },
    }),
    { name: 'lopsy-shortcut-customizations' },
  ),
);

/**
 * Build a runtime map of key → actionId from the current custom + default
 * bindings. Custom bindings shadow defaults. Used by the shortcut handler to
 * resolve a pressed key to an action.
 */
export function buildKeyToActionMap(customShortcuts: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();

  // Seed with defaults
  for (const [actionId, key] of Object.entries(NON_TOOL_DEFAULTS)) {
    map.set(key, actionId);
  }
  for (const descriptor of Object.values(toolRegistry)) {
    if (descriptor.shortcut) {
      map.set(descriptor.shortcut.toLowerCase(), descriptor.id);
    }
  }

  // Custom bindings shadow defaults — first remove any existing default that
  // mapped to the same key, then add the custom entry.
  for (const [actionId, key] of Object.entries(customShortcuts)) {
    // Remove any other action that previously owned this key
    for (const [k, existingAction] of map) {
      if (k === key && existingAction !== actionId) {
        map.delete(k);
      }
    }
    // Remove the old key this action used to own
    for (const [k, existingAction] of map) {
      if (existingAction === actionId) {
        map.delete(k);
      }
    }
    map.set(key, actionId);
  }

  return map;
}
