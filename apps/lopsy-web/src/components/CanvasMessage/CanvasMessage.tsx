import { useEffect, useId, useRef } from 'react';
import { ImageOff } from 'lucide-react';
import { useCanvasMessageStore } from '../../app/canvas-message-store';
import { useEditorStore } from '../../app/editor-store';
import { Button } from '../Button/Button';
import styles from './CanvasMessage.module.css';

interface CanvasMessageProps {
  /**
   * 'canvas' (the default) centres it in its positioned parent, the canvas
   * area, under the menus' popovers; 'window' centres it in the window above
   * the start screen, where there is no canvas yet.
   */
  placement?: 'canvas' | 'window';
}

/**
 * The message centred over the canvas (app/canvas-message-store.ts): a
 * heading, the words and OK. It is announced as an alert dialog and takes
 * focus, which goes back where it was once it is dismissed (OK or Escape).
 * It covers only itself, so the menus and the canvas around it still work.
 */
export function CanvasMessage({ placement = 'canvas' }: CanvasMessageProps) {
  const message = useCanvasMessageStore((s) => s.message);
  const dismiss = useCanvasMessageStore((s) => s.dismiss);
  const documentVersion = useEditorStore((s) => s.documentVersion);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Whether focus is in the message, so dismissing it gives focus back only when it had taken it. */
  const hasFocusRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const isStale = message !== null && message.documentVersion !== documentVersion;

  // Another document opened: the message was about the one that did not.
  useEffect(() => {
    if (isStale) dismiss();
  }, [isStale, dismiss]);

  // Focus moves to it as it shows, and back to where it was when it goes.
  useEffect(() => {
    if (message === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.querySelector('button')?.focus();
    return () => {
      if (hasFocusRef.current && previous?.isConnected) previous.focus();
      hasFocusRef.current = false;
    };
  }, [message]);

  // The canvas listens on the window for presses and the wheel; this is not the canvas.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (e: Event) => e.stopPropagation();
    root.addEventListener('pointerdown', stop);
    root.addEventListener('wheel', stop);
    return () => {
      root.removeEventListener('pointerdown', stop);
      root.removeEventListener('wheel', stop);
    };
  }, [message]);

  if (message === null || isStale) return null;

  return (
    <div
      ref={rootRef}
      className={`${styles.message} ${placement === 'window' ? styles.overWindow : ''}`}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="canvas-message"
      onFocus={() => {
        hasFocusRef.current = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hasFocusRef.current = false;
      }}
      onKeyDown={(e) => {
        // Its own keys: Escape dismisses, and nothing reaches the editor's shortcuts.
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          dismiss();
        }
      }}
    >
      <ImageOff className={styles.icon} size={28} aria-hidden="true" />
      <h2 id={titleId} className={styles.title}>
        {message.title}
      </h2>
      <p id={bodyId} className={styles.body}>
        {message.body}
      </p>
      <Button variant="primary" className={styles.ok} onClick={dismiss}>
        OK
      </Button>
    </div>
  );
}
