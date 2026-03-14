import styles from './KeyboardShortcutsModal.module.css';

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

interface ShortcutEntry {
  label: string;
  key: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const sections: ShortcutSection[] = [
  {
    title: 'Tools',
    shortcuts: [
      { label: 'Move', key: 'V' },
      { label: 'Brush', key: 'B' },
      { label: 'Pencil', key: 'N' },
      { label: 'Eraser', key: 'E' },
      { label: 'Fill', key: 'G' },
      { label: 'Eyedropper', key: 'I' },
      { label: 'Text', key: 'T' },
      { label: 'Shape', key: 'U' },
      { label: 'Marquee', key: 'M' },
      { label: 'Lasso', key: 'L' },
      { label: 'Magic Wand', key: 'W' },
      { label: 'Crop', key: 'C' },
      { label: 'Path', key: 'P' },
      { label: 'Stamp', key: 'S' },
      { label: 'Dodge', key: 'O' },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { label: 'Undo', key: '\u2318Z' },
      { label: 'Redo', key: '\u21E7\u2318Z' },
      { label: 'Cut', key: '\u2318X' },
      { label: 'Copy', key: '\u2318C' },
      { label: 'Paste', key: '\u2318V' },
      { label: 'Deselect', key: '\u2318D' },
      { label: 'Merge Down', key: '\u2318E' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { label: 'Zoom In', key: '\u2318+' },
      { label: 'Zoom Out', key: '\u2318\u2212' },
      { label: 'Fit to Screen', key: '\u23180' },
      { label: 'Actual Size', key: '\u23181' },
      { label: 'Pan Canvas', key: 'Space' },
    ],
  },
  {
    title: 'Colors',
    shortcuts: [
      { label: 'Swap Colors', key: 'X' },
      { label: 'Reset Colors', key: 'D' },
    ],
  },
  {
    title: 'Canvas',
    shortcuts: [
      { label: 'Clear Selection / Cancel', key: 'Esc' },
      { label: 'Delete Selection / Layer', key: 'Del' },
      { label: 'Stroke Path', key: 'Enter' },
    ],
  },
];

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Keyboard Shortcuts</h2>
        </div>
        <div className={styles.body}>
          {sections.map((section) => (
            <div key={section.title} className={styles.section}>
              <h3>{section.title}</h3>
              <div className={styles.shortcutList}>
                {section.shortcuts.map((shortcut) => (
                  <div key={shortcut.label} className={styles.shortcutRow}>
                    <span className={styles.shortcutLabel}>{shortcut.label}</span>
                    <span className={styles.shortcutKey}>{shortcut.key}</span>
                  </div>
                ))}
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
