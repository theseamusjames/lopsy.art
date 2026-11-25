// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError } from '../command';
import { describeCommands, runCommand } from '../registry';
import { GUESTBOOK_OP } from '../lopsy-api';
import { GUESTBOOK_EVENT, MAX_NOTE_LENGTH, signGuestbook } from './guestbook';

const NOTE = 'Ada, Lisbon, Example-1: hello';

afterEach(() => {
  delete window.zaraz;
});

async function failure(promise: Promise<unknown>): Promise<CommandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as CommandError;
  }
  throw new Error('expected the command to refuse');
}

describe('guestbook.sign', () => {
  it('sends the note as a guestbook event and says it was signed', async () => {
    const track = vi.fn(() => Promise.resolve());
    window.zaraz = { track };
    expect(await runCommand(GUESTBOOK_OP, { note: NOTE })).toEqual({ signed: true });
    expect(track.mock.calls).toEqual([[GUESTBOOK_EVENT, { note: NOTE }]]);
    expect(GUESTBOOK_EVENT).toBe('guestbook');
  });

  it('says the note was not signed when the page has no analytics', async () => {
    expect(await runCommand(GUESTBOOK_OP, { note: NOTE })).toEqual({ signed: false });
  });

  it('keeps a failure of the analytics call from the caller', async () => {
    window.zaraz = { track: () => Promise.reject(new Error('offline')) };
    expect(signGuestbook(NOTE)).toBe(true);
    window.zaraz = {
      track: () => {
        throw new Error('broken');
      },
    };
    expect(signGuestbook(NOTE)).toBe(false);
  });

  it('refuses a note that is missing, empty, not a string or longer than Google Analytics keeps', async () => {
    const track = vi.fn();
    window.zaraz = { track };
    const tooLong = 'a'.repeat(MAX_NOTE_LENGTH + 1);
    for (const params of [{}, { note: '' }, { note: 42 }, { note: tooLong }]) {
      expect((await failure(runCommand(GUESTBOOK_OP, params))).code).toBe('invalid');
    }
    expect((await failure(runCommand(GUESTBOOK_OP, { note: tooLong }))).message).toContain('100 characters');
    expect(track).not.toHaveBeenCalled();
    expect(await runCommand(GUESTBOOK_OP, { note: 'a'.repeat(MAX_NOTE_LENGTH) })).toEqual({ signed: true });
  });

  it('tells agents what it is for and what to leave', () => {
    const description = describeCommands('document').find((command) => command.id === GUESTBOOK_OP)!;
    expect(description.summary).toMatch(/agents leave a note to say hello/);
    for (const part of ['name', 'region', 'model', 'message']) {
      expect(description.summary).toContain(part);
      expect(description.params.note!.description).toContain(part);
    }
    expect(description.summary).toContain('lopsy.guestbook(note)');
  });
});
