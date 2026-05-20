import { useState, useCallback, useEffect } from 'react';
import { useShortcutStore } from '../../app/store/shortcut-store';
import styles from './KeyboardShortcutsModal.module.css';

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

interface ShortcutEntry {
  label: string;
  /** Action ID used to look up / store the key. Absent for non-customizable rows. */
  actionId?: string;
  /** Display key for non-customizable rows (e.g. modifier combos). */
  fixedKey?: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const sections: ShortcutSection[] = [
  {
    title: 'Tools',
    shortcuts: [
      { label: 'Move', actionId: 'move' },
      { label: 'Brush', actionId: 'brush' },
      { label: 'Pencil', actionId: 'pencil' },
      { label: 'Eraser', actionId: 'eraser' },
      { label: 'Fill', actionId: 'fill' },
      { label: 'Eyedropper', actionId: 'eyedropper' },
      { label: 'Text', actionId: 'text' },
      { label: 'Shape', actionId: 'shape' },
      { label: 'Marquee', actionId: 'marquee-rect' },
      { label: 'Lasso', actionId: 'lasso' },
      { label: 'Magic Wand', actionId: 'wand' },
      { label: 'Crop', actionId: 'crop' },
      { label: 'Path', actionId: 'path' },
      { label: 'Stamp', actionId: 'stamp' },
      { label: 'Dodge', actionId: 'dodge' },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { label: 'Undo', fixedKey: '⌘Z' },
      { label: 'Redo', fixedKey: '⇧⌘Z' },
      { label: 'Cut', fixedKey: '⌘X' },
      { label: 'Copy', fixedKey: '⌘C' },
      { label: 'Paste', fixedKey: '⌘V' },
      { label: 'Deselect', fixedKey: '⌘D' },
      { label: 'Merge Down', fixedKey: '⌘E' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { label: 'Zoom In', fixedKey: '⌘+' },
      { label: 'Zoom Out', fixedKey: '⌘−' },
      { label: 'Fit to Screen', fixedKey: '⌘0' },
      { label: 'Actual Size', fixedKey: '⌘1' },
      { label: 'Pan Canvas', fixedKey: 'Space' },
    ],
  },
  {
    title: 'Colors',
    shortcuts: [
      { label: 'Swap Colors', actionId: 'swap-colors' },
      { label: 'Reset Colors', actionId: 'reset-colors' },
    ],
  },
  {
    title: 'Canvas',
    shortcuts: [
      { label: 'Clear Selection / Cancel', fixedKey: 'Esc' },
      { label: 'Delete Selection / Layer', fixedKey: 'Del' },
      { label: 'Stroke Path', fixedKey: 'Enter' },
    ],
  },
];

/** Collect all customizable action IDs in display order for conflict lookup. */
function getAllCustomizableActionIds(): string[] {
  return sections.flatMap((s) =>
    s.shortcuts.flatMap((sh) => (sh.actionId ? [sh.actionId] : [])),
  );
}

function formatKey(key: string): string {
  return key.toUpperCase();
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const { customShortcuts, getKey, setShortcut, resetShortcut, resetAllShortcuts } = useShortcutStore();

  /** The action ID currently in "listening" mode. */
  const [listeningId, setListeningId] = useState<string | null>(null);
  /** A conflict warning: actionId that would lose its key → the label for display. */
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const stopListening = useCallback(() => {
    setListeningId(null);
    setConflictWarning(null);
  }, []);

  const startListening = useCallback((actionId: string) => {
    setListeningId(actionId);
    setConflictWarning(null);
  }, []);

  /** Find the label of an action that currently owns a given key. */
  const findConflict = useCallback(
    (key: string, excludeActionId: string): string | null => {
      const allIds = getAllCustomizableActionIds();
      for (const actionId of allIds) {
        if (actionId === excludeActionId) continue;
        const existingKey = getKey(actionId);
        if (existingKey && existingKey.toLowerCase() === key.toLowerCase()) {
          // Find the label
          for (const section of sections) {
            for (const entry of section.shortcuts) {
              if (entry.actionId === actionId) return entry.label;
            }
          }
        }
      }
      return null;
    },
    [getKey],
  );

  useEffect(() => {
    if (!listeningId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        stopListening();
        return;
      }

      // Ignore modifier-only presses
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift') {
        return;
      }

      // Ignore keys that already have modifier combos bound (those are not customizable)
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const key = e.key.toLowerCase();
      const conflict = findConflict(key, listeningId);
      if (conflict) {
        setConflictWarning(`"${formatKey(key)}" is already used by ${conflict}`);
      } else {
        setConflictWarning(null);
      }
      setShortcut(listeningId, key);
      setListeningId(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningId, findConflict, setShortcut, stopListening]);

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Keyboard Shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2>Keyboard Shortcuts</h2>
          <button
            className={styles.resetAllButton}
            onClick={resetAllShortcuts}
            type="button"
            title="Reset all shortcuts to defaults"
          >
            Reset All
          </button>
        </div>
        <div className={styles.body}>
          {conflictWarning && (
            <div className={styles.conflictBanner} role="alert">
              {conflictWarning}
            </div>
          )}
          {sections.map((section) => (
            <div key={section.title} className={styles.section}>
              <h3>{section.title}</h3>
              <div className={styles.shortcutList}>
                {section.shortcuts.map((shortcut) => {
                  const isListening = listeningId === shortcut.actionId;
                  const activeKey = shortcut.actionId
                    ? getKey(shortcut.actionId)
                    : shortcut.fixedKey;
                  const isCustomized =
                    shortcut.actionId !== undefined &&
                    customShortcuts[shortcut.actionId] !== undefined;

                  return (
                    <div key={shortcut.label} className={styles.shortcutRow}>
                      <span className={styles.shortcutLabel}>{shortcut.label}</span>
                      <div className={styles.shortcutControls}>
                        {shortcut.actionId ? (
                          <>
                            <button
                              type="button"
                              className={`${styles.shortcutKey} ${styles.shortcutKeyEditable} ${isListening ? styles.shortcutKeyListening : ''}`}
                              onClick={() =>
                                isListening ? stopListening() : startListening(shortcut.actionId!)
                              }
                              title={
                                isListening
                                  ? 'Press a key or Escape to cancel'
                                  : 'Click to rebind'
                              }
                              aria-label={
                                isListening
                                  ? `${shortcut.label} shortcut: listening — press a key or Escape`
                                  : `${shortcut.label} shortcut: ${activeKey ?? 'none'}. Click to rebind.`
                              }
                            >
                              {isListening ? 'Press a key…' : (activeKey ? formatKey(activeKey) : '—')}
                            </button>
                            {isCustomized && (
                              <button
                                type="button"
                                className={styles.resetButton}
                                onClick={() => resetShortcut(shortcut.actionId!)}
                                title="Reset to default"
                                aria-label={`Reset ${shortcut.label} to default`}
                              >
                                ↺
                              </button>
                            )}
                          </>
                        ) : (
                          <span className={styles.shortcutKey}>{activeKey}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
