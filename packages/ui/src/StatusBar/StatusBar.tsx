import type { ReactNode } from 'react';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  readonly children: ReactNode;
  /** What a screen reader calls the bar. */
  readonly label?: string;
  /**
   * Whether the bar is a polite live region (`role="status"`), so a change
   * to what it shows is said. Lopsy's is; a bar whose counts change with
   * every click would talk too much.
   */
  readonly isLive?: boolean;
  readonly 'data-testid'?: string;
}

/** The 24 px bar along the bottom of an app's window: items, dividers, and a spacer between the left and right groups. */
export function StatusBar({ children, label = 'Status bar', isLive = true, 'data-testid': testId }: StatusBarProps) {
  return (
    <footer className={styles.bar} role={isLive ? 'status' : undefined} aria-label={label} data-testid={testId}>
      {children}
    </footer>
  );
}

export interface StatusItemProps {
  readonly children: ReactNode;
  /**
   * What the item is, said before its value by a screen reader and not
   * shown ("Renderer" makes "Renderer: WebGPU"). Leave it out when the value
   * says what it is.
   */
  readonly name?: string;
  /** Shown in the primary text colour, for a state worth noticing (Lopsy's colour mode). */
  readonly isEmphasized?: boolean;
  readonly 'data-testid'?: string;
}

/** One reading in the bar, in the secondary text colour. */
export function StatusItem({ children, name, isEmphasized = false, 'data-testid': testId }: StatusItemProps) {
  return (
    <span className={isEmphasized ? `${styles.item} ${styles.emphasized}` : styles.item} data-testid={testId}>
      {name && <span className={styles.name}>{`${name}: `}</span>}
      {children}
    </span>
  );
}

/** A number inside an item, in the monospace face and the primary text colour. */
export function StatusNumber({ children }: { readonly children: ReactNode }) {
  return <span className={styles.number}>{children}</span>;
}

/** The thin rule between two items. */
export function StatusDivider() {
  return <span className={styles.divider} aria-hidden="true" />;
}

/** Takes the room between the left group and the right one. */
export function StatusSpacer() {
  return <span className={styles.spacer} />;
}

/** An item's type and colour, for a control that sits in the bar as an item (Lopsy's zoom readout). */
export const STATUS_ITEM_CLASS: string = styles.item ?? '';
