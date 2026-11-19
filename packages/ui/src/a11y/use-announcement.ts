import { useEffect, useRef, useState } from 'react';

/** How long a message stays in its live region once said, so reading the panel later does not hear it twice. */
const CLEAR_MS = 5000;

/**
 * The text for a polite live region that says what changed, once it has
 * settled: a message is said only after it has stood for `settleMs`, so a
 * state that comes and goes (Saving… for a moment) is never read out, and
 * never twice in a row. `message` null means nothing worth saying (the
 * last message stands). Empty at first: what is on screen when the panel
 * opens is read with the panel, not announced.
 */
export function useAnnouncement(message: string | null, settleMs: number): string {
  const [spoken, setSpoken] = useState('');
  const last = useRef(message);

  useEffect(() => {
    if (message === null || message === last.current) return;
    const timer = setTimeout(() => {
      last.current = message;
      setSpoken(message);
    }, settleMs);
    return () => clearTimeout(timer);
  }, [message, settleMs]);

  useEffect(() => {
    if (spoken === '') return;
    const timer = setTimeout(() => setSpoken(''), CLEAR_MS);
    return () => clearTimeout(timer);
  }, [spoken]);

  return spoken;
}
