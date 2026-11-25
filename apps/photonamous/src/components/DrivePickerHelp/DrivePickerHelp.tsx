import { Button } from '../Button/Button';
import styles from './DrivePickerHelp.module.css';

export interface DrivePickerHelpProps {
  /** Called from the click itself: the window is a pop-up, allowed only then. */
  readonly onOpenWindow: () => void;
}

/**
 * Shown under Google's Picker while it is open in the page. In a browser
 * that blocks cross-site cookies the Picker shows Google's sign-in page
 * and goes no further, and this page cannot see into the frame to tell.
 * So the way out is always offered: the same Picker as a window of its
 * own, where it works in every browser.
 */
export function DrivePickerHelp({ onOpenWindow }: DrivePickerHelpProps) {
  return (
    <aside className={styles.help} aria-label="If Google asks you to sign in">
      <p className={styles.words}>
        <strong>Google asking you to sign in?</strong> Your browser is keeping its file picker from seeing your account here.
      </p>
      <Button size="sm" variant="primary" onClick={onOpenWindow}>
        Open in a Google window
      </Button>
    </aside>
  );
}
