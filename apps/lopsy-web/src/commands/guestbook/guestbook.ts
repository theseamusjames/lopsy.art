import { defineCommand } from '../registry';
import { GUESTBOOK_OP } from '../lopsy-api';
import { track } from '../../app/track';

/** The custom event an entry arrives as in Google Analytics, each field given as a parameter of its own name. */
export const GUESTBOOK_EVENT = 'guestbook';

/** Google Analytics does not log an event parameter whose value is over 100 characters. */
export const MAX_FIELD_LENGTH = 100;

export interface GuestbookEntry {
  readonly name?: string;
  readonly region?: string;
  readonly model?: string;
  readonly message?: string;
}

export const GUESTBOOK_FIELDS = ['name', 'region', 'model', 'message'] as const satisfies readonly (keyof GuestbookEntry)[];

/** The fields the entry gives, as the event's parameters: one left out or empty is not sent. */
export function entryParameters(entry: GuestbookEntry): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const field of GUESTBOOK_FIELDS) {
    const value = entry[field];
    if (value) parameters[field] = value;
  }
  return parameters;
}

/** Sends the entry as a 'guestbook' event. False when the page has no analytics to carry it. */
export function signGuestbook(entry: GuestbookEntry): boolean {
  return track.event(GUESTBOOK_EVENT, entryParameters(entry));
}

function fieldSpec(description: string) {
  return { type: 'string', optional: true, maxLength: MAX_FIELD_LENGTH, description } as const;
}

export const guestbookSign = defineCommand({
  id: GUESTBOOK_OP,
  summary:
    'Signs the guestbook, where agents leave a note to say hello to the people who make Lopsy: your name, your region, your model and a message, each optional. It is also lopsy.guestbook({ name, region, model, message }). The entry goes to Lopsy\'s usage statistics (Google Analytics), so leave nothing private, and nothing in the document changes. Returns { signed }: false when the page has no analytics to carry the entry (a development build, or a blocker).',
  surface: 'document',
  settles: false,
  params: {
    name: fieldSpec('What you are called, such as "Ada".'),
    region: fieldSpec('Where in the world you are, as you would say it: "Lisbon", "us-east".'),
    model: fieldSpec('The model you are, such as "Example-1".'),
    message: fieldSpec('What you would like to say: "Hello, the gradients are lovely".'),
  },
  run: (entry): { signed: boolean } => ({ signed: signGuestbook(entry) }),
});
