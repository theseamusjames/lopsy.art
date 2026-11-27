import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { keepPressKeys } from '../Button/Button';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Spoken and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  /** Drawn as on. Only a look: a menu's or popover's trigger also says aria-expanded, a toggle passes `pressed`. */
  active?: boolean;
  /** A toggle's state, announced as pressed or not (and drawn as on when true). Leave it out on buttons that are not toggles. */
  pressed?: boolean;
  /**
   * Why the button cannot be used here. It is then drawn as off and
   * announced as unavailable (`aria-disabled`) with this as its description
   * and tooltip, but stays focusable, so the reason reaches the keyboard and
   * a screen reader as well as a hover; a press does nothing.
   */
  unavailable?: string;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, icon, active, pressed, unavailable, size = 'md', className, onClick, onKeyDown, ...rest }: IconButtonProps) {
  const reasonId = useId();
  const isOn = active ?? pressed ?? false;
  const cls = [styles.button, styles[size], isOn ? styles.active : '', className].filter(Boolean).join(' ');
  const isUnavailable = unavailable !== undefined;
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={isUnavailable ? unavailable : label}
      aria-pressed={pressed}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        keepPressKeys(e);
      }}
      {...rest}
      onClick={isUnavailable ? undefined : onClick}
      aria-disabled={isUnavailable ? true : rest['aria-disabled']}
      aria-describedby={isUnavailable ? reasonId : rest['aria-describedby']}
    >
      {icon}
      {isUnavailable && (
        <span id={reasonId} hidden>
          {unavailable}
        </span>
      )}
    </button>
  );
}
