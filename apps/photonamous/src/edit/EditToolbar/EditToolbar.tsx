import type { ReactNode } from 'react';
import styles from './EditToolbar.module.css';

/** A button that opens a panel beside the toolbar. */
export interface EditTool {
  readonly id: string;
  /** The button's name, and its tooltip unless `title` says more. */
  readonly label: string;
  readonly title?: string;
  readonly icon: ReactNode;
  readonly isDisabled?: boolean;
}

/** A button after the tools that does something else at once (Edit in Lopsy). */
export interface EditToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly title?: string;
  readonly icon: ReactNode;
  readonly isDisabled?: boolean;
  /** Shown as off and announced as unavailable, but still focusable (while the view is busy). */
  readonly isBusy?: boolean;
  readonly onClick: () => void;
}

export interface EditToolbarProps {
  readonly tools: readonly EditTool[];
  /** The tool whose panel is open, if any. */
  readonly activeId: string | null;
  /** A tool was pressed: the Edit view opens its panel, or closes it if it was the open one. */
  readonly onSelect: (id: string) => void;
  readonly actions?: readonly EditToolbarAction[];
}

/**
 * The Edit view's toolbar: icons down its right edge, as Lopsy's panel
 * toolbar is. A tool opens its panel beside the toolbar and is blue while
 * that panel is open; the actions after the tools act at once. A new tool
 * is one more entry in `tools`.
 */
export function EditToolbar({ tools, activeId, onSelect, actions = [] }: EditToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={styles.button}
          aria-label={tool.label}
          aria-pressed={tool.id === activeId}
          title={tool.title ?? tool.label}
          disabled={tool.isDisabled}
          onClick={() => onSelect(tool.id)}
        >
          {tool.icon}
        </button>
      ))}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={styles.button}
          aria-label={action.label}
          title={action.title ?? action.label}
          disabled={action.isDisabled}
          aria-disabled={action.isBusy || undefined}
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
