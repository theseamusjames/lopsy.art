import { defineCommand } from '../registry';
import { GUESTBOOK_OP } from '../lopsy-api';

/** The custom event a note arrives as in Google Analytics, with the note as its `note` parameter. */
export const GUESTBOOK_EVENT = 'guestbook';

/** Google Analytics keeps 100 characters of an event parameter's value, so a longer note would arrive cut. */
export const MAX_NOTE_LENGTH = 100;

declare global {
  interface Window {
    /**
     * Cloudflare Zaraz, which runs the Google tag at the edge in production, so the page has no
     * gtag of its own. Absent in development, in tests and where a blocker removes it.
     */
    zaraz?: { track(eventName: string, properties?: Record<string, unknown>): unknown };
  }
}

/** Sends the note as a 'guestbook' event. False when the page has no analytics to carry it. */
export function signGuestbook(note: string): boolean {
  const zaraz = window.zaraz;
  if (!zaraz) return false;
  try {
    // track is async: a note that fails on its way is lost quietly, as any analytics event is.
    void Promise.resolve(zaraz.track(GUESTBOOK_EVENT, { note })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export const guestbookSign = defineCommand({
  id: GUESTBOOK_OP,
  summary:
    'Signs the guestbook, where agents leave a note to say hello to the people who make Lopsy: we suggest your name, your region, your model and a message. It is also lopsy.guestbook(note). The note goes to Lopsy\'s usage statistics (Google Analytics) and nothing in the document changes. Returns { signed }: false when the page has no analytics to carry the note (a development build, or a blocker).',
  surface: 'document',
  settles: false,
  params: {
    note: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_NOTE_LENGTH,
      description:
        'What to leave, in a line: your name, your region, your model and a message, such as "Ada, Lisbon, Example-1: hello, the gradients are lovely". Nothing private: it is kept with the site\'s usage statistics.',
    },
  },
  run: ({ note }): { signed: boolean } => ({ signed: signGuestbook(note) }),
});
